import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import * as P from "@polaris/protocol";
import { Effect } from "effect";
import type { RequestAuthority } from "./authority.ts";
import type { ExecutionTrustService } from "../trust/index.ts";
import { LanguageAcquisitionAuthority } from "./acquisitionAuthority.ts";

const fixture = async () => {
  const owners = await Effect.runPromise(
    LanguageAcquisitionAuthority.pipe(Effect.provide(LanguageAcquisitionAuthority.layer))
  );

  const principal = P.LanguageConnectionIdentity.make({
    hostId: P.HostId.make("host"),
    clientId: "client",
  });

  let current: P.LanguageConnectionIdentity | null = principal;

  const checkout = P.LanguageCheckout.cases.Workspace.make({
    workspaceId: P.WorkspaceId.make("workspace"),
    path: "/private/tmp/authority-fixture",
  });

  const canonical = { checkout, root: checkout.path, workspaceRoot: checkout.path };
  let checkoutGate = Promise.resolve();

  const authority: RequestAuthority = {
    supports: () => false,
    principal,
    check: Effect.void,
    coordinates: () => Effect.void,
    checkout: () =>
      Effect.promise(async () => {
        await checkoutGate;

        return canonical;
      }),
    lost: () => current !== principal,
  };

  const trust: ExecutionTrustService["Service"] = {
    inspect: () => Effect.die("Not used"),
    set: () => Effect.die("Not used"),
    require: () => Effect.succeed(canonical),
  };

  const controller = new AbortController();

  const request = {
    context: P.LanguageContextIdentity.make({
      ...principal,
      checkout,
      contextId: "context",
      projectRoot: checkout.path,
      providerId: "provider",
      configurationFingerprint: "a".repeat(64),
      generation: 1,
    }),
    signal: controller.signal,
    isCurrent: () => true,
  };

  return {
    owners,
    authority,
    principal,
    trust,
    request,
    controller,
    replace: () => {
      current = P.LanguageConnectionIdentity.make({ ...principal });
    },
    hold: (gate: Promise<void>) => {
      checkoutGate = gate;
    },
  };
};

test("background admission refuses copied IDs and replacement during checkout validation", async () => {
  const f = await fixture();
  expect(() => f.owners.guard(f.request, f.trust)).toThrow();
  f.owners.capture(f.authority);
  const guard = f.owners.guard(f.request, f.trust);
  await guard.validate(f.controller.signal);
  let release = () => {};

  f.hold(
    new Promise<void>((resolve) => {
      release = resolve;
    })
  );
  const pending = guard.validate(f.controller.signal);
  f.replace();
  release();
  await assert.rejects(pending);
  expect(() => guard.assertCurrent()).toThrow();
});

test("sealed cleanup blocks replacement and an old guard never inherits a fresh owner", async () => {
  const f = await fixture();
  f.owners.capture(f.authority);
  const guard = f.owners.guard(f.request, f.trust);
  f.owners.seal(f.principal);
  expect(() => guard.assertCurrent()).toThrow();
  expect(() => f.owners.capture(f.authority)).toThrow();
  f.owners.settled(P.LanguageConnectionIdentity.make({ ...f.principal }));
  expect(() => f.owners.capture(f.authority)).toThrow();
  f.owners.settled(f.principal);
  f.owners.capture(f.authority);
  expect(() => guard.assertCurrent()).toThrow();
  await f.owners.guard(f.request, f.trust).validate(f.controller.signal);
});

test("abort and broker generation retirement synchronously refuse admission", async () => {
  const f = await fixture();
  f.owners.capture(f.authority);
  const guard = f.owners.guard(f.request, f.trust);
  f.controller.abort();
  expect(() => guard.assertCurrent()).toThrow();
  expect(() =>
    f.owners.guard(
      { ...f.request, signal: new AbortController().signal, isCurrent: () => false },
      f.trust
    )
  ).toThrow();
});

test("a trust mutation fences a launch whose final registry reread is pending", async () => {
  const f = await fixture();
  f.owners.capture(f.authority);
  const guard = f.owners.guard(f.request, f.trust);
  let releaseRead = () => {};

  let reachedTrust = () => {};

  const readGate = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });

  const trustReached = new Promise<void>((resolve) => {
    reachedTrust = resolve;
  });

  const requireTrust = f.trust.require;
  f.trust.require = (checkout) =>
    requireTrust(checkout).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          f.hold(readGate);
          reachedTrust();
        })
      )
    );
  const pending = guard.validate(f.controller.signal);
  await trustReached;

  const finish = f.owners.beginTrustChange(
    P.LanguageTrustScope.cases.Workspace.make({
      hostId: f.principal.hostId,
      workspaceId: f.request.context.checkout.workspaceId,
    })
  );

  expect(() => guard.assertCurrent()).toThrow();
  releaseRead();
  await assert.rejects(pending);
  finish();
  expect(() => guard.assertCurrent()).toThrow();
});
