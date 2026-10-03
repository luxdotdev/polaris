import { expect, test } from "bun:test";
import { realpath, mkdtemp, rm, writeFile, cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as P from "@polaris/protocol";
import { Effect, Layer, Predicate, Redacted } from "effect";
import { connectRpc, socketTransport } from "@polaris/client";
import { EventStore } from "../../store/EventStore.ts";
import { startServer } from "../../transport/server.ts";
import { lazyLanguageHandlers } from "../../transport/lazyLanguages.ts";

const requiredPath = (key: string) => {
  const value = process.env[key];

  if (value === undefined || !value.startsWith("/"))
    throw new Error(`Set ${key} to an existing absolute Host path`);

  return value;
};

const node = requiredPath("M31_NODE_EXECUTABLE");

const serverCli = requiredPath("M31_TYPESCRIPT_SERVER");

const typescriptPackage = requiredPath("M31_TYPESCRIPT_PACKAGE");

const caps: P.Capability[] = [
  "languages",
  "languages.trust",
  "languages.format",
  "languages.buffer-acknowledgments",
  "languages.edit-preparation",
];

test("actual default Host routes launch existing TS server only after authenticated trust and serve unsaved completion", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const root = yield* Effect.acquireRelease(
          Effect.promise(async () => realpath(await mkdtemp("/private/tmp/m31-live-ts-"))),
          (r) => Effect.promise(() => rm(r, { recursive: true, force: true }))
        );

        const project = join(root, "project");
        yield* Effect.promise(async () => {
          await mkdir(project);
          await writeFile(join(project, "package.json"), "{}");
          await mkdir(join(project, "node_modules"));
          await cp(typescriptPackage, join(project, "node_modules", "typescript"), {
            recursive: true,
            dereference: true,
          });
          await writeFile(join(project, "a.ts"), "const saved = 1;");
        });
        const workspaceId = P.WorkspaceId.make("fixture");
        const store = yield* EventStore;
        yield* store.commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              P.DomainEvent.cases.WorkspaceRegistered.make({
                workspace: new P.Workspace({
                  id: workspaceId,
                  path: project,
                  name: "fixture",
                  isGitRepo: false,
                  worktreeRoot: join(root, "trees"),
                  hidden: false,
                  registeredAt: new Date().toISOString(),
                }),
              }),
            ]),
        });

        const server = yield* startServer({
          root,
          socketPath: join(root, "d.sock"),
          lockPath: join(root, "d.lock"),
          capabilities: caps,
          handlers: lazyLanguageHandlers.pipe(Layer.provide(Layer.succeed(EventStore)(store))),
        });

        const rpc = yield* connectRpc(yield* socketTransport(server.socketPath));

        const hello = yield* rpc.client.hello({
          clientName: "live-ts-proof",
          clientVersion: "0",
          deviceLabel: "isolated",
          capabilities: caps,
          languageProof: Redacted.make("f".repeat(64)),
        });

        if (hello.languageIdentity === undefined)
          throw new Error("Authenticated identity unavailable");

        const scope = P.LanguageTrustScope.cases.Workspace.make({
          hostId: hello.host.hostId,
          workspaceId,
        });

        const trust = yield* rpc.client["languages.trust.set"]({
          scope,
          trusted: true,
          expectedRevision: 0,
        });

        expect(trust.trusted).toBe(true);
        const checkout = P.LanguageCheckout.cases.Workspace.make({ workspaceId, path: project });
        const executable = yield* Effect.promise(() => realpath(node));

        const settings = P.LanguageEffectiveSettings.make({
          revision: 0,
          formatOnSave: true,
          formatter: P.LanguageFormatterSelection.cases.Provider.make({
            providerId: "typescript-language-server",
          }),
          providers: ["typescript-language-server"],
          origins: {},
          settings: {
            executableOverrides: {
              "typescript-language-server": {
                executable,
                argv: [serverCli, "--stdio"],
                environment: {},
              },
            },
          },
        });

        const discovered = yield* rpc.client["languages.discover"]({
          checkout,
          path: join(project, "a.ts"),
          documentLanguageId: "typescript",
          settings,
        });

        expect(discovered.providers.map((provider) => provider.preflight)).toEqual([
          P.LanguagePreflight.cases.Eligible.make({ artifactId: null }),
        ]);

        const input = {
          clientId: hello.languageIdentity.clientId,
          contextId: "real-ts",
          checkout,
          path: join(project, "a.ts"),
          providerId: "typescript-language-server",
          settings,
          interestId: "file",
        };

        let snapshot = yield* rpc.client["languages.context.acquire"](input);
        const uri = pathToFileURL(join(project, "a.ts")).href;
        const draft = "const unsavedThing = 1;\nunsa";

        const ack = yield* rpc.client["languages.document.sync"]({
          context: snapshot.context,
          sequence: 1,
          notification: P.LanguageDocumentNotification.cases.Open.make({
            uri,
            languageId: "typescript",
            version: 1,
            text: draft,
          }),
        });

        for (let i = 0; i < 300 && !Predicate.isTagged(snapshot.runtime, "Ready"); i++) {
          yield* Effect.sleep("20 millis");
          snapshot = yield* rpc.client["languages.context.acquire"](input);

          if (Predicate.isTagged(snapshot.runtime, "Failed"))
            throw new Error(snapshot.runtime.message);
        }

        expect(Predicate.isTagged(snapshot.runtime, "Ready")).toBe(true);

        const fence = P.LanguageRequestFence.make({
          context: snapshot.context,
          requiredSequence: ack.acceptedSequence,
          documents: [{ uri, version: 1 }],
        });

        const completion = yield* rpc.client["languages.request"](
          P.LanguageFeatureRequest.make({
            requestId: "completion",
            fence,
            method: "textDocument/completion",
            params: { textDocument: { uri }, position: { line: 1, character: 4 } },
            deadline: Date.now() + 10000,
          })
        );

        expect(JSON.stringify(completion)).toContain("unsavedThing");
        expect(yield* Effect.promise(() => Bun.file(join(project, "a.ts")).text())).toBe(
          "const saved = 1;"
        );
        yield* rpc.client["languages.context.release"]({
          context: snapshot.context,
          interestId: "file",
        });
      })
    ).pipe(Effect.provide(EventStore.layerSqlite(":memory:")))
  );
}, 20000);
