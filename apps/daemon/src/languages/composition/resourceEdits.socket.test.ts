import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { join } from "node:path";
import * as P from "@polaris/protocol";
import { connectRpc, socketTransport } from "@polaris/client";
import { Effect, Fiber, Layer, Redacted, Schema, Stream } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { startServer } from "../../transport/server.ts";
import { ServerRpcs } from "../../transport/rpcs.ts";
import { fixture } from "../../files/edits/trees/testing.ts";
import { fingerprint } from "../../files/edits/journal.ts";
import { HostProposalEvidence } from "../preparation/provenance.ts";
import { ServerBridge } from "../runtime/server.ts";
import { ContextEvents } from "../runtime/events.ts";
import { Documents } from "../runtime/documents.ts";
import { OrderedConnection } from "../transport/index.ts";
import { memoryPort } from "../transport/fixture.testing.ts";
import { HostLanguageEnvironment } from "./environment.ts";
import { denied, requestAuthority } from "./authority.ts";
import { resourceReceiptAuthority } from "./resourceEditsAuthority.ts";
import { LanguageResourceEdits, resourceEditHandlers } from "./resourceEdits.ts";
import { languageResourceEditHandlers } from "./resourceEditsHandlers.ts";

test("authenticated socket feed/response verifies durable group before real tree moves and guarded undo", async () => {
  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const f = yield* Effect.acquireRelease(Effect.promise(fixture), (value) =>
          Effect.promise(value.cleanup)
        );

        const base = yield* Effect.promise(() => f.request(f.chain()));
        const store = yield* EventStore;
        yield* store.commit({
          commandId: null,
          decide: () =>
            Effect.succeed([
              P.DomainEvent.cases.WorkspaceRegistered.make({
                workspace: new P.Workspace({
                  id: f.owner.checkout.workspaceId,
                  path: f.root,
                  name: "resources-socket",
                  isGitRepo: false,
                  worktreeRoot: join(f.home, "worktrees"),
                  hidden: false,
                  registeredAt: new Date().toISOString(),
                }),
              }),
            ]),
        });
        const evidence = new HostProposalEvidence();
        const events = new ContextEvents();
        const provider = memoryPort();

        const connection = new OrderedConnection(
          provider.port,
          () => {},
          () => {}
        );

        let bridge: ServerBridge | undefined;
        let principal: P.LanguageConnectionIdentity | null = null;
        let issued: P.LanguageTreeEditProposal | undefined;
        let recoveredRevision: number | null = null;
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            bridge?.close();
            events.close();
            evidence.dispose();
            await connection.close();
          })
        );

        const provenance = {
          record: () => Effect.die("unused"),
          revoke: () => Effect.void,
          verify: (
            owner: P.LanguageConnectionIdentity,
            proposal: P.LanguageTreeEditProposal | P.LanguageEditProposal
          ) => Effect.tryPromise({ try: () => evidence.verify(owner, proposal), catch: denied }),
        };

        const handlers = Layer.unwrap(
          Effect.gen(function* () {
            const environment = yield* HostLanguageEnvironment;

            const receipts = resourceReceiptAuthority(
              {
                challengeReceipt: (clientId, context, challenge, signal) =>
                  Effect.tryPromise({
                    try: async () => {
                      if (
                        bridge === undefined ||
                        principal?.clientId !== clientId ||
                        issued === undefined ||
                        fingerprint(context) !== fingerprint(issued.fence.context)
                      )
                        throw denied();

                      return bridge.challengeReceipt(challenge, signal);
                    },
                    catch: denied,
                  }),
                challengeRecoveryReceipt: (clientId, context, challenge, signal) =>
                  Effect.tryPromise({
                    try: async () => {
                      if (
                        bridge === undefined ||
                        principal?.clientId !== clientId ||
                        issued === undefined ||
                        fingerprint(context) !== fingerprint(issued.fence.context)
                      )
                        throw denied();

                      return bridge.challengeReceipt(challenge, signal);
                    },
                    catch: denied,
                  }),
              },
              provenance,
              (value) => value === principal
            );

            const resources = resourceEditHandlers(
              { hostId: environment.hostId, journalRoot: join(f.home, "journal") },
              {
                receipts,
                provenance,
                owners: { owns: (owner) => owner === principal, trustFence: () => () => {} },
                trust: {
                  require: () =>
                    Effect.succeed({
                      checkout: f.owner.checkout,
                      root: f.root,
                      workspaceRoot: f.root,
                    }),
                },
              }
            );

            return Layer.mergeAll(
              languageResourceEditHandlers.pipe(
                Layer.provide(Layer.succeed(LanguageResourceEdits)(resources))
              ),
              ServerRpcs.toLayerHandler("languages.context.watch", (input) =>
                Stream.unwrap(
                  Effect.gen(function* () {
                    const auth = yield* requestAuthority(environment.hostId);
                    yield* auth.coordinates(input.context);

                    if (principal !== null) return yield* Effect.fail(denied());
                    principal = auth.principal;
                    issued = Schema.decodeUnknownSync(P.LanguageTreeEditProposal)({
                      ...base.proposal,
                      fence: { ...base.proposal.fence, context: input.context },
                    });
                    const proposal = issued;
                    yield* Effect.promise(() =>
                      evidence.record(auth.principal, proposal, async () => {
                        if (auth.lost()) throw denied();
                      })
                    );
                    bridge = new ServerBridge({
                      context: input.context,
                      documents: new Documents(input.context),
                      connection,
                      settings: {},
                      emit: (event) => events.emit(event),
                      current: () => !auth.lost(),
                      authorize: async () => {
                        await Effect.runPromise(auth.check);
                      },
                      treeEdits: () => true,
                      prepareEdit: undefined,
                      capabilities: () => {},
                    });

                    return Stream.fromAsyncIterable(
                      events.watch(
                        P.LanguageContextEvent.cases.Log.make({
                          context: input.context,
                          level: "info",
                          message: "Scripted fixture ready",
                        })
                      ),
                      () => denied()
                    );
                  })
                )
              ),
              ServerRpcs.toLayerHandler("languages.server.respond", (input) =>
                Effect.gen(function* () {
                  const auth = yield* requestAuthority(environment.hostId);
                  yield* auth.coordinates(input.context);

                  if (auth.principal !== principal || bridge === undefined)
                    return yield* Effect.fail(denied());
                  const active = bridge;
                  yield* Effect.promise(() => active.respond(input));
                })
              )
            );
          })
        ).pipe(Layer.provide(Layer.succeed(EventStore)(store)));

        const server = yield* startServer({
          root: f.home,
          socketPath: join(f.home, "d.sock"),
          lockPath: join(f.home, "d.lock"),
          capabilities: [
            "languages",
            "languages.edits",
            "languages.resources",
            "languages.resources.tree-v2",
          ],
          handlers,
        });

        const owned = yield* connectRpc(yield* socketTransport(server.socketPath));
        const attacker = yield* connectRpc(yield* socketTransport(server.socketPath));
        const proof = "e".repeat(64);

        const hello = (value: string): typeof P.Hello.payloadSchema.Type => ({
          clientName: "resources",
          clientVersion: "0",
          deviceLabel: "scripted",
          capabilities: [
            "languages",
            "languages.edits",
            "languages.resources",
            "languages.resources.tree-v2",
          ],
          languageProof: Redacted.make(value),
        });

        yield* owned.client.hello(hello(proof));
        yield* attacker.client.hello(hello("d".repeat(64)));

        const clientId =
          "language-" +
          createHash("sha256")
            .update(JSON.stringify(["polaris-language-client-v1", server.hostInfo.hostId, proof]))
            .digest("hex");

        const context = P.LanguageContextIdentity.make({
          ...base.proposal.fence.context,
          hostId: server.hostInfo.hostId,
          clientId,
        });

        const proposal = Schema.decodeUnknownSync(P.LanguageTreeEditProposal)({
          ...base.proposal,
          fence: { ...base.proposal.fence, context },
        });

        const acceptance = P.LanguageTreeEditAcceptance.make({
          ...base.acceptance,
          fence: proposal.fence,
        });

        const drafts = P.LanguageTreeDraftReceipt.make({
          ...base.drafts,
          previewFingerprint: fingerprint(proposal),
        });

        let challenged = 0;
        let moving = 0;

        const feed = yield* Stream.runForEach(
          owned.client["languages.context.watch"]({ context }),
          (event) =>
            Effect.gen(function* () {
              if (
                !Schema.is(P.LanguageContextEvent.cases.ServerRequest)(event) ||
                !Schema.is(P.LanguageServerRequestPayload.cases.ResourceReceipt)(event.payload)
              )
                return;
              const challenge = event.payload.challenge;
              challenged++;

              if (Schema.is(P.LanguageResourceReceiptChallenge.cases.Verify)(challenge)) {
                expect(challenge.phase).toBeDefined();

                if (challenge.phase === "moving") moving++;
              }

              const result: P.LanguageResourceReceiptResponse = {
                nonce: challenge.nonce,
                operationId: challenge.operationId,
                groupId: drafts.groupId,
                localRevision: 1,
                previewFingerprint: fingerprint(proposal),
                hostReceiptRevision: recoveredRevision,
              };

              const resolved = Schema.is(P.LanguageResourceReceiptChallenge.cases.Resolve)(
                challenge
              )
                ? { ...result, proposal }
                : result;

              const response = P.LanguageServerResponse.make({
                context,
                response: {
                  jsonrpc: "2.0",
                  id: event.request.request.id,
                  result: Schema.encodeSync(P.LanguageResourceReceiptResponse)(resolved),
                },
              });

              const foreign = yield* Effect.flip(
                attacker.client["languages.server.respond"](response)
              );

              expect(foreign.reason).toBe("not-owner");
              yield* owned.client["languages.server.respond"](response);
            })
        ).pipe(Effect.forkChild);

        for (let i = 0; i < 100 && issued === undefined; i++) yield* Effect.sleep(1);
        expect(issued).toBeDefined();
        const outcome = yield* owned.client["languages.tree.edit.decide"]({ acceptance, drafts });
        expect(outcome.state).toBe("applied");
        expect(outcome.format).toBe(2);
        expect(challenged).toBeGreaterThan(4);
        expect(moving).toBeGreaterThan(0);
        recoveredRevision = outcome.receiptRevision;

        const restored = yield* owned.client["languages.tree.operation.recover"]({
          checkout: context.checkout,
          clientId,
          operationId: outcome.operationId,
          intent: "undo",
          expectedReceiptRevision: outcome.receiptRevision,
        });

        expect(restored.state).toBe("restored");
        expect(provider.messages).toHaveLength(0);
        yield* Effect.sync(() => events.close());
        yield* Fiber.join(feed);
      })
    ).pipe(Effect.provide(EventStore.layerSqlite(":memory:")))
  );
});
