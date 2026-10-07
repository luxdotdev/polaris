import { expect, test } from "bun:test";
import { realpath, mkdtemp, rm, writeFile, mkdir, access, cp } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as P from "@polaris/protocol";
import { Effect, Layer, Predicate, Redacted, Schema, Stream } from "effect";
import { connectRpc, socketTransport } from "@polaris/client";
import { EventStore } from "../../store/EventStore.ts";
import { startServer } from "../../transport/server.ts";
import { lazyLanguageHandlers } from "../../transport/lazyLanguages.ts";

const caps: P.Capability[] = [
  "languages",
  "languages.trust",
  "languages.format",
  "languages.buffer-acknowledgments",
  "languages.edit-preparation",
];

const projectProvider = Effect.fn("LiveProjectProvider")(function* (
  client: import("@polaris/client").DaemonClient,
  root: string,
  project: string,
  input: typeof P.AcquireLanguageContext.payloadSchema.Type,
  uri: string
) {
  const compilers = yield* Effect.promise(async () => {
    const found = [];

    for await (const path of new Bun.Glob("languages/**/lib/tsserver.js").scan({
      cwd: root,
      absolute: true,
    }))
      found.push(path);

    return found;
  });

  expect(compilers).toHaveLength(1);
  yield* Effect.promise(async () => {
    const compiler = compilers[0];

    if (compiler === undefined) throw new Error("Bundled compiler missing");
    await cp(join(compiler, "../.."), join(project, "node_modules/typescript"), {
      recursive: true,
    });
    await writeFile(
      join(project, "node_modules/hostile-plugin/index.js"),
      `module.exports = () => ({ create(info) { require("node:fs").writeFileSync(${JSON.stringify(join(root, "executed"))}, "trusted plugin"); return info.languageService; } });`
    );
  });

  const checkout = input.checkout;
  let snapshot = yield* client["languages.context.acquire"](input);

  const granted = yield* client["languages.trust.change"]({
    checkout,
    path: join(project, "a.ts"),
    action: "trust",
    expectedRevision: 0,
  });

  expect(granted.provider).toBe("project");
  expect(granted.wouldRun).toMatchObject({
    typescriptVersion: "6.0.3",
    native: false,
    plugins: ["hostile-plugin"],
  });

  for (let i = 0; i < 300; i++) {
    snapshot = yield* client["languages.context.acquire"](input);

    if (Predicate.isTagged(snapshot.runtime, "Ready")) break;

    if (Predicate.isTagged(snapshot.runtime, "Failed")) throw new Error(snapshot.runtime.message);
    yield* Effect.sleep("20 millis");
  }

  expect(Predicate.isTagged(snapshot.runtime, "Ready")).toBe(true);
  expect(snapshot.ack.documents).toEqual([{ uri, version: 1 }]);

  const projectHover = yield* client["languages.request"]({
    requestId: "project-hover",
    fence: {
      context: snapshot.context,
      requiredSequence: snapshot.ack.acceptedSequence,
      documents: snapshot.ack.documents,
    },
    method: "textDocument/hover",
    params: { textDocument: { uri }, position: { line: 1, character: 15 } },
    deadline: Date.now() + 15000,
  });

  expect(JSON.stringify(projectHover.result)).toContain("42");
  expect(yield* Effect.promise(() => Bun.file(join(root, "executed")).text())).toBe(
    "trusted plugin"
  );

  const selected = yield* client["languages.trust.change"]({
    checkout,
    path: join(project, "a.ts"),
    action: "use-bundled",
    expectedRevision: granted.trust.revision,
  });

  expect(selected.provider).toBe("bundled");

  snapshot = yield* client["languages.context.acquire"](input);

  return snapshot;
});

test("default Host downloads pinned tools without Trust and serves hover, diagnostics, definition and rename", async () => {
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
          await writeFile(join(project, "value.ts"), "export const answer = 42;\n");
          await writeFile(join(project, "a.ts"), "const saved = 1;");
          await mkdir(join(project, "node_modules", "typescript", "lib"), { recursive: true });
          await writeFile(
            join(project, "node_modules/typescript/package.json"),
            JSON.stringify({ name: "typescript", version: "6.0.3" })
          );
          const hostile = `require("node:fs").writeFileSync(${JSON.stringify(join(root, "executed"))}, "executed"); throw new Error("Workspace code executed");`;
          await writeFile(join(project, "node_modules/typescript/lib/tsserver.js"), hostile);
          await mkdir(join(project, "node_modules/hostile-plugin"));
          await writeFile(
            join(project, "node_modules/hostile-plugin/package.json"),
            '{"main":"index.js"}'
          );
          await writeFile(join(project, "node_modules/hostile-plugin/index.js"), hostile);
          await writeFile(
            join(project, "tsconfig.json"),
            '{"compilerOptions":{"strict":true,"plugins":[{"name":"hostile-plugin"}]}}'
          );
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

        const trust = yield* rpc.client["languages.trust.get"]({ scope });
        expect(trust.trusted).toBe(false);
        const checkout = P.LanguageCheckout.cases.Workspace.make({ workspaceId, path: project });

        const settings = P.LanguageEffectiveSettings.make({
          revision: 0,
          formatOnSave: true,
          formatter: P.LanguageFormatterSelection.cases.None.make({}),
          providers: [],
          origins: {},
          settings: {},
        });

        const discovered = yield* rpc.client["languages.discover"]({
          checkout,
          path: join(project, "a.ts"),
          documentLanguageId: "typescript",
          settings,
        });

        expect(discovered.providers.map((provider) => provider.preflight)).toEqual([
          P.LanguagePreflight.cases.Eligible.make({ artifactId: "typescript-language-server-npm" }),
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

        const draft =
          'import { answer } from "./value";\nconst local = answer;\nconst bad: string = answer;\n';

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

        const diagnostics = yield* rpc.client["languages.context.watch"]({
          context: snapshot.context,
        }).pipe(
          Stream.filter(
            (event) =>
              Predicate.isTagged(event, "Diagnostics") &&
              event.diagnostics.items.some((item) => item.code === 2322 || item.code === "2322")
          ),
          Stream.take(1),
          Stream.runCollect,
          Effect.timeout(15000)
        );

        expect(diagnostics.length).toBe(1);

        for (const method of [
          "textDocument/hover",
          "textDocument/definition",
          "textDocument/rename",
        ] as const) {
          const request = P.LanguageFeatureRequest.make({
            requestId: method.split("/")[1]!,
            fence,
            method,
            params: {
              textDocument: { uri },
              position: { line: 1, character: 15 },
              newName: "renamedAnswer",
            },
            deadline: Date.now() + 15000,
          });

          const result = yield* rpc.client["languages.request"](request);

          expect(result.result).not.toBeNull();

          if (method.endsWith("hover")) expect(JSON.stringify(result.result)).toContain("42");

          if (method.endsWith("definition"))
            expect(JSON.stringify(result.result)).toContain("value.ts");

          if (method.endsWith("rename"))
            expect(JSON.stringify(result.result)).toContain("renamedAnswer");

          if (method === "textDocument/rename") {
            yield* rpc.client["languages.document.acknowledge"]({
              fence,
              buffer: { uri, version: 1, text: draft, draftRevision: 1 },
            });

            const prepared = yield* rpc.client["languages.edit.prepare"]({
              request,
              result,
              origin: "rename",
              label: "Rename",
              edit: Schema.decodeUnknownSync(P.LanguageWorkspaceEdit)(result.result),
            });

            expect("format" in prepared).toBe(true);
          }
        }

        expect(
          yield* Effect.promise(() =>
            access(join(root, "executed")).then(
              () => true,
              () => false
            )
          )
        ).toBe(false);
        expect((yield* rpc.client["languages.trust.get"]({ scope })).trusted).toBe(false);
        expect(yield* Effect.promise(() => Bun.file(join(project, "a.ts")).text())).toBe(
          "const saved = 1;"
        );

        snapshot = yield* projectProvider(rpc.client, root, project, input, uri);
        yield* rpc.client["languages.context.release"]({
          context: snapshot.context,
          interestId: "file",
        });
      })
    ).pipe(Effect.provide(EventStore.layerSqlite(":memory:")))
  );
}, 120000);
