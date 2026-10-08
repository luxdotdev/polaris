import { expect, test } from "bun:test";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as P from "@polaris/protocol";
import { Deferred, Effect, Fiber, Stream, Predicate } from "effect";
import { EventStore } from "../../store/EventStore.ts";
import { CurrentLanguageConnection } from "../../transport/currentLanguageConnection.ts";
import { catalog } from "../catalog/index.ts";
import { LanguageTrustGrantAuthority, LanguageConnectionLifetime } from "./ports.ts";

import { fixture, hostId, run } from "./core.testing.ts";

test("Core observation admission keeps nested canonical projects distinct and retires after trust changes", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();

      yield* f.run(
        f.core.availability({
          toolIds: ["typescript-language-server"],
          checkout: null,
          phase: "feature",
          refresh: true,
        })
      );
      expect(f.observations).toHaveLength(0);

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(
            Effect.provideService(LanguageTrustGrantAuthority, { authorize: () => Effect.void })
          )
      );

      yield* f.run(
        f.core.availability({
          toolIds: ["typescript-language-server"],
          checkout: f.checkout,
          phase: "feature",
          refresh: true,
        })
      );

      const first = f.observations[0];

      if (first === undefined) throw new Error("Canonical observation admission missing");
      expect(first.cwd).toBe(f.root);

      const signal = new AbortController().signal;

      yield* Effect.promise(() => first.requireCurrent(signal));

      const nested = join(f.root, "nested");

      yield* Effect.promise(async () => {
        await mkdir(nested);
        await writeFile(join(nested, "package.json"), "{}");
        await writeFile(join(nested, "file.ts"), "nested");
      });

      const found = yield* f.run(
        f.core.discover({
          checkout: f.checkout,
          path: join(nested, "file.ts"),
          documentLanguageId: "typescript",
          settings: f.settings,
        })
      );

      const nestedAdmission = f.observations.at(-1);

      expect(found.projectRoot).toBe(nested);
      expect(nestedAdmission?.cwd).toBe(nested);
      expect(nestedAdmission).not.toBe(first);

      yield* f.run(
        f.core
          .trustSet(scope, false, 1)
          .pipe(
            Effect.provideService(LanguageTrustGrantAuthority, { authorize: () => Effect.void })
          )
      );

      const refused = yield* Effect.result(
        Effect.tryPromise({ try: () => first.requireCurrent(signal), catch: (cause) => cause })
      );

      expect(Predicate.isTagged(refused, "Failure")).toBe(true);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("core uses accepted catalog and real discovery; unavailable activation is not installed or executable", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      const result = yield* f.run(f.core.catalog);
      expect(result.tools.length).toBe(catalog.tools.length);

      const discovery = yield* f.run(
        f.core.discover({
          checkout: f.checkout,
          path: f.input.path,
          documentLanguageId: "typescript",
          settings: f.settings,
        })
      );

      expect(discovery.projectRoot).toBe(f.root);
      expect(discovery.trust.trusted).toBe(false);
      expect(discovery.providers.length).toBeGreaterThan(0);
      expect(discovery.providers.every((value) => value.launch === null)).toBe(true);
      expect(
        discovery.providers.every((value) =>
          P.LanguagePreflight.match(value.preflight, { Blocked: () => true, Eligible: () => false })
        )
      ).toBe(true);
      const acquired = yield* f.run(f.core.acquire(f.input));
      expect(acquired.context.clientId).toBe("actual-client");
      expect(f.spawns()).toBe(0);
      f.disconnect();
      expect(yield* Effect.flip(f.run(f.core.catalog))).toBeInstanceOf(P.LanguageError);
    })
  );
});

test("core rejects foreign Client, Host, stale generation and forged checkout before delegated access", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      expect(
        yield* Effect.flip(f.run(f.core.acquire({ ...f.input, clientId: "foreign" })))
      ).toBeInstanceOf(P.LanguageError);
      expect((yield* f.broker.stats).contexts).toBe(0);
      const snapshot = yield* f.run(f.core.acquire(f.input));

      for (const context of [
        P.LanguageContextIdentity.make({ ...snapshot.context, clientId: "foreign" }),
        P.LanguageContextIdentity.make({ ...snapshot.context, hostId: P.HostId.make("foreign") }),
        P.LanguageContextIdentity.make({
          ...snapshot.context,
          generation: snapshot.context.generation + 1,
        }),
        P.LanguageContextIdentity.make({
          ...snapshot.context,
          checkout: P.LanguageCheckout.cases.Workspace.make({
            workspaceId: f.checkout.workspaceId,
            path: "/private/tmp",
          }),
        }),
      ])
        expect(yield* Effect.flip(f.run(f.core.restart(context)))).toBeInstanceOf(P.LanguageError);
      const restarted = yield* f.run(f.core.restart(snapshot.context));
      expect(restarted.context.generation).toBeGreaterThan(snapshot.context.generation);
      expect(yield* Effect.flip(f.run(f.core.release(snapshot.context, "file")))).toBeInstanceOf(
        P.LanguageError
      );
      yield* f.run(f.core.cancel(restarted.context, "unknown-request"));
      yield* f.run(f.core.release(restarted.context, "file"));
      expect(f.spawns()).toBe(0);
    })
  );
});

test("trust grants default-deny, use real CAS and invalidate broker generations after explicit independent grant", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      const snapshot = yield* f.run(f.core.acquire(f.input));

      const denied = f
        .run(f.core.trustSet(scope, true, 0))
        .pipe(Effect.provide(LanguageTrustGrantAuthority.denyLayer));

      expect(yield* Effect.flip(denied)).toBeInstanceOf(P.LanguageError);
      expect((yield* f.run(f.core.trustGet(scope))).trusted).toBe(false);

      const grant = LanguageTrustGrantAuthority.of({
        authorize: (principal, requested) =>
          Effect.sync(() => {
            expect(principal.clientId).toBe("actual-client");
            expect(requested).toEqual(scope);
          }),
      });

      const changed = yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(Effect.provideService(LanguageTrustGrantAuthority, grant))
      );

      expect(changed.revision).toBe(1);
      expect(changed.trusted).toBe(true);
      expect(yield* Effect.flip(f.run(f.core.restart(snapshot.context)))).toBeInstanceOf(
        P.LanguageError
      );
      expect(
        yield* Effect.flip(
          f.run(
            f.core.trustGet(
              P.LanguageTrustScope.cases.Workspace.make({
                hostId: P.HostId.make("wrong"),
                workspaceId: scope.workspaceId,
              })
            )
          )
        )
      ).toBeInstanceOf(P.LanguageError);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("the project's formatter is discovered without Trust and runs only once trusted", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      const bin = join(f.root, "node_modules", ".bin");
      const record = join(f.root, "ran");

      yield* Effect.promise(async () => {
        await writeFile(join(f.root, ".prettierrc"), "{}");
        await mkdir(bin, { recursive: true });
        await writeFile(join(bin, "prettier"), `#!/bin/sh\ntouch "${record}"\ntr a-z A-Z\n`, {
          mode: 0o755,
        });
      });

      const discovery = yield* f.run(
        f.core.discover({
          checkout: f.checkout,
          path: f.input.path,
          documentLanguageId: "typescript",
          settings: f.settings,
        })
      );

      expect(discovery.projectFormatter).toMatchObject({
        tool: "prettier",
        installed: true,
        ignored: false,
      });

      const request = P.LanguageProjectFormatInput.make({
        checkout: f.checkout,
        path: f.input.path,
        requestId: "format-1",
        version: 3,
        text: "unsaved",
        deadline: Date.now() + 5000,
      });

      const refused = yield* Effect.flip(f.run(f.core.formatProject(request)));
      expect(refused.reason).toBe("awaiting-trust");
      expect(yield* Effect.promise(() => Bun.file(record).exists())).toBe(false);

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(
            Effect.provideService(
              LanguageTrustGrantAuthority,
              LanguageTrustGrantAuthority.of({ authorize: () => Effect.void })
            )
          )
      );

      expect(yield* f.run(f.core.formatProject(request))).toEqual(
        P.LanguageProjectFormatOutcome.cases.Formatted.make({
          requestId: "format-1",
          version: 3,
          tool: "prettier",
          text: "UNSAVED",
        })
      );
    })
  );
});

test("context feed, configure and server-response paths delegate through current owned broker", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      const snapshot = yield* f.run(f.core.acquire(f.input));

      const event = yield* f.core
        .watch(snapshot.context)
        .pipe(
          Stream.take(1),
          Stream.runCollect,
          Effect.provideService(CurrentLanguageConnection, f.connection),
          Effect.provideService(EventStore, f.store)
        );

      expect(event.length).toBe(1);
      const changed = yield* f.run(f.core.configure(snapshot.context, f.settings));
      expect(changed.context.generation).toBeGreaterThan(snapshot.context.generation);

      const error = yield* Effect.flip(
        f.run(
          f.core.respond({
            context: changed.context,
            response: { jsonrpc: "2.0", id: "missing", result: null },
          })
        )
      );

      expect(error).toBeInstanceOf(P.LanguageError);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("replacement during actual discovery wait rejects adoption and removes the abandoned broker context", async () => {
  await run(
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const f = yield* fixture({ entered, release });
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
      const pending = yield* f.run(f.core.acquire(f.input)).pipe(Effect.flip, Effect.forkScoped);
      yield* Deferred.await(entered);
      f.replace();
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(pending)).toBeInstanceOf(P.LanguageError);
      expect((yield* f.broker.stats).contexts).toBe(0);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("feature and document sync reach real broker validation without executing an unavailable provider", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      const snapshot = yield* f.run(f.core.acquire(f.input));

      const request = P.LanguageFeatureRequest.make({
        requestId: "hover",
        fence: { context: snapshot.context, requiredSequence: 0, documents: [] },
        method: "textDocument/hover",
        params: {},
        deadline: Date.now() + 1000,
      });

      expect(yield* Effect.flip(f.run(f.core.request(request)))).toBeInstanceOf(P.LanguageError);

      const notification = P.LanguageDocumentNotification.cases.Open.make({
        uri: pathToFileURL(join(f.root, "file.ts")).href,
        languageId: "typescript",
        version: 1,
        text: "unsaved",
      });

      expect(
        yield* Effect.flip(
          f.run(f.core.sync({ context: snapshot.context, sequence: 1, notification }))
        )
      ).toBeInstanceOf(P.LanguageError);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("missing lifetime registration denies acquisition; revoked grant wait cannot commit trust", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();
      expect(
        yield* Effect.flip(
          f.run(
            f.core
              .acquire(f.input)
              .pipe(Effect.provide(LanguageConnectionLifetime.unavailableLayer))
          )
        )
      ).toBeInstanceOf(P.LanguageError);
      expect((yield* f.broker.stats).contexts).toBe(0);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      const grant = LanguageTrustGrantAuthority.of({
        authorize: () =>
          Effect.andThen(Deferred.succeed(entered, undefined), Deferred.await(release)),
      });

      const pending = yield* f
        .run(
          f.core
            .trustSet(scope, true, 0)
            .pipe(Effect.provideService(LanguageTrustGrantAuthority, grant))
        )
        .pipe(Effect.flip, Effect.forkScoped);

      yield* Deferred.await(entered);
      f.replace();
      yield* Deferred.succeed(release, undefined);
      expect(yield* Fiber.join(pending)).toBeInstanceOf(P.LanguageError);
      expect((yield* f.run(f.core.trustGet(scope))).revision).toBe(0);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("trusted document sync acknowledges actual broker state but missing installation fails without spawn or retries", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture();

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(
            Effect.provideService(
              LanguageTrustGrantAuthority,
              LanguageTrustGrantAuthority.of({ authorize: () => Effect.void })
            )
          )
      );
      const acquired = yield* f.run(f.core.acquire(f.input));

      const failed = yield* f.core.watch(acquired.context).pipe(
        Stream.filter(
          (event) =>
            Predicate.isTagged(event, "RuntimeChanged") &&
            Predicate.isTagged(event.runtime, "Failed")
        ),
        Stream.take(1),
        Stream.runCollect,
        Effect.provideService(CurrentLanguageConnection, f.connection),
        Effect.provideService(EventStore, f.store),
        Effect.timeout(2000),
        Effect.forkScoped
      );

      const notification = P.LanguageDocumentNotification.cases.Open.make({
        uri: pathToFileURL(join(f.root, "file.ts")).href,
        languageId: "typescript",
        version: 1,
        text: "unsaved",
      });

      const ack = yield* f.run(
        f.core.sync({ context: acquired.context, sequence: 1, notification })
      );

      expect(ack.acceptedSequence).toBe(1);
      const events = yield* Fiber.join(failed);
      expect(events.length).toBe(1);
      expect(f.spawns()).toBe(0);
      expect((yield* f.broker.stats).processes).toBe(0);
    })
  );
});

test("authenticated buffer acknowledgments use the real mirror and refuse forged text and closed documents", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture(undefined, true);

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(
            Effect.provideService(LanguageTrustGrantAuthority, { authorize: () => Effect.void })
          )
      );
      const acquired = yield* f.run(f.core.acquire(f.input));
      const uri = pathToFileURL(join(f.root, "file.ts")).href;

      const notification = P.LanguageDocumentNotification.cases.Open.make({
        uri,
        languageId: "typescript",
        version: 1,
        text: "private draft",
      });

      yield* f.run(f.core.sync({ context: acquired.context, sequence: 1, notification }));

      const fence = P.LanguageRequestFence.make({
        context: acquired.context,
        requiredSequence: 1,
        documents: [{ uri, version: 1 }],
      });

      const principal = f.connection.current();

      if (principal === null) throw new Error("Fixture lost its independent principal");
      const current = () => f.connection.current() === principal;

      expect(yield* f.broker.readPreparationDocument(principal, current, fence, uri)).toEqual({
        version: 1,
        text: "private draft",
      });
      expect(
        yield* Effect.flip(f.broker.readAcknowledgedBuffer(principal, current, fence, uri))
      ).toBeInstanceOf(P.LanguageError);

      const buffer = { uri, version: 1, text: "private draft", draftRevision: 7 };
      const receipt = yield* f.run(f.core.acknowledge({ fence, buffer }));
      expect(receipt.draftRevision).toBe(7);
      expect("text" in receipt).toBe(false);

      const request = P.LanguageFeatureRequest.make({
        requestId: "fabricated-edit",
        fence,
        method: "textDocument/rename",
        params: { textDocument: { uri }, newName: "replacement" },
        deadline: Date.now() + 5000,
      });

      const edit = P.LanguageWorkspaceEdit.make({ changes: { [uri]: [] } });

      const result = P.LanguageFeatureResult.make({
        requestId: request.requestId,
        fence,
        result: edit,
      });

      const fabricated = yield* f.run(
        f.core
          .prepare({ request, result, edit, origin: "rename", label: "Rename" })
          .pipe(Effect.result)
      );

      expect(Predicate.isTagged(fabricated, "Failure")).toBe(true);

      const resourceEdit = P.LanguageWorkspaceEdit.make({
        documentChanges: [{ kind: "delete", uri }],
      });

      const oldPeer = yield* f.run(
        Effect.flip(
          f.core.prepare({ request, result, edit: resourceEdit, origin: "rename", label: "Delete" })
        )
      );

      expect(oldPeer.reason).toBe("unsupported-capability");

      const wrongText = yield* f.run(
        f.core.acknowledge({ fence, buffer: { ...buffer, text: "forged" } }).pipe(Effect.result)
      );

      expect(Predicate.isTagged(wrongText, "Failure")).toBe(true);
      yield* f.run(
        f.core.sync({
          context: acquired.context,
          sequence: 2,
          notification: P.LanguageDocumentNotification.cases.Close.make({ uri, version: 1 }),
        })
      );
      const closed = yield* f.run(f.core.acknowledge({ fence, buffer }).pipe(Effect.result));
      expect(Predicate.isTagged(closed, "Failure")).toBe(true);
      f.replace();
      const replaced = yield* f.run(f.core.acknowledge({ fence, buffer }).pipe(Effect.result));
      expect(Predicate.isTagged(replaced, "Failure")).toBe(true);
      expect(f.spawns()).toBe(0);
    })
  );
});

test("committed trust revocation retires another Client even when the caller's post-write authority is lost", async () => {
  await run(
    Effect.gen(function* () {
      const f = yield* fixture(undefined, true);

      const scope = P.LanguageTrustScope.cases.Workspace.make({
        hostId,
        workspaceId: f.checkout.workspaceId,
      });

      const grant = LanguageTrustGrantAuthority.of({ authorize: () => Effect.void });
      yield* f.run(
        f.core
          .trustSet(scope, true, 0)
          .pipe(Effect.provideService(LanguageTrustGrantAuthority, grant))
      );

      const otherPrincipal = P.LanguageConnectionIdentity.make({
        hostId,
        clientId: "other-client",
      });

      const otherConnection = CurrentLanguageConnection.of({ current: () => otherPrincipal });

      const other = yield* f.run(
        f.core
          .acquire({ ...f.input, clientId: otherPrincipal.clientId, contextId: "other-context" })
          .pipe(Effect.provideService(CurrentLanguageConnection, otherConnection))
      );

      f.onTrustWrite(f.disconnect);

      const revoked = yield* f.run(
        f.core
          .trustSet(scope, false, 1)
          .pipe(Effect.provideService(LanguageTrustGrantAuthority, grant), Effect.result)
      );

      expect(Predicate.isTagged(revoked, "Failure")).toBe(true);

      const oldGeneration = yield* f.broker
        .snapshot(otherPrincipal.clientId, other.context)
        .pipe(Effect.result);

      expect(Predicate.isTagged(oldGeneration, "Failure")).toBe(true);

      const observed = yield* f.run(
        f.core
          .trustGet(scope)
          .pipe(Effect.provideService(CurrentLanguageConnection, otherConnection))
      );

      expect(observed.trusted).toBe(false);
      expect(observed.revision).toBe(2);
      expect(f.spawns()).toBe(0);
    })
  );
});
