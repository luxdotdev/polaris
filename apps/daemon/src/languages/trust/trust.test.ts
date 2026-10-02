import { rejects } from "node:assert/strict";
import { expect, test } from "bun:test";
import { join } from "node:path";
import { LanguageCheckout, LanguageTrustScope, HostId } from "@polaris/protocol";
import { fixture } from "../discovery/fixture.ts";
import { createExecutionTrust, checkoutKey, TrustRecord } from "./index.ts";
import { createFileTrustRepository } from "./repository.ts";

test("durable Workspace grant inherited by Worktrees; Review Checkout requires separate explicit grant", async () => {
  const f = await fixture();

  try {
    const options = {
      hostId: f.hostId,
      registry: f.registry,
      repository: createFileTrustRepository(join(f.temporary, "host-state")),
      authorizeGrant: async () => {},
    };

    const trust = createExecutionTrust(options);
    const invoked: string[] = [];

    for (const operation of [
      "Prisma config",
      "formatter config",
      "TypeScript plugins",
      "Cargo build",
    ]) {
      await rejects(
        trust.execute(f.checkout, async () => {
          invoked.push(operation);
        }),
        /requires trust/
      );
    }

    expect(invoked).toEqual([]);
    expect((await trust.inspect(f.checkout)).trust.trusted).toBe(false);
    await trust.set(f.checkout, true, 0);

    const restarted = createExecutionTrust({
      ...options,
      repository: createFileTrustRepository(join(f.temporary, "host-state")),
    });

    expect((await restarted.inspect(f.checkout)).trust.trusted).toBe(true);
    expect((await restarted.inspect(f.treeCheckout)).trust.trusted).toBe(true);
    expect((await restarted.inspect(f.reviewCheckout)).trust.trusted).toBe(false);
    await rejects(
      restarted.execute(f.reviewCheckout, async () => invoked.push("review")),
      /requires trust/
    );
    await restarted.set(f.reviewCheckout, true, 0);
    await restarted.execute(f.reviewCheckout, async (canonical) => invoked.push(canonical.root));
    expect(invoked).toEqual([f.review]);
    await restarted.set(f.checkout, false, 1);
    await rejects(
      restarted.execute(f.treeCheckout, async () => invoked.push("revoked")),
      /requires trust/
    );
    expect((await restarted.inspect(f.reviewCheckout)).trust.trusted).toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("trust cannot be borrowed with a spoofed path, checkout identity or changed canonical root", async () => {
  const f = await fixture();

  try {
    const trust = createExecutionTrust({
      hostId: f.hostId,
      registry: f.registry,
      repository: createFileTrustRepository(join(f.temporary, "state")),
      authorizeGrant: async () => {},
    });

    await trust.set(f.checkout, true, 0);

    const spoof = LanguageCheckout.cases.Workspace.make({
      workspaceId: f.workspaceId,
      path: f.review,
    });

    await rejects(trust.require(spoof), /registry/);
    f.registrations.set(checkoutKey(f.checkout), { checkout: spoof, workspacePath: f.review });
    expect((await trust.inspect(spoof)).trust.trusted).toBe(false);
    await rejects(trust.require(spoof), /requires trust/);
    await trust.set(spoof, true, 1);
    expect((await trust.inspect(spoof)).trust.trusted).toBe(true);
  } finally {
    await f.cleanup();
  }
});

test("grant authorization, stale revisions, concurrent CAS and Host isolation", async () => {
  const f = await fixture();

  try {
    const repository = createFileTrustRepository(join(f.temporary, "state"));

    const options = {
      hostId: f.hostId,
      registry: f.registry,
      repository,
      authorizeGrant: async () => {},
    };

    const denied = createExecutionTrust({
      ...options,
      authorizeGrant: async () => {
        throw new Error("Not authorized");
      },
    });

    await rejects(denied.set(f.checkout, true, 0), /Not authorized/);
    const trust = createExecutionTrust(options);

    const outcomes = await Promise.allSettled([
      trust.set(f.checkout, true, 0),
      trust.set(f.checkout, false, 0),
    ]);

    expect(outcomes.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(({ status }) => status === "rejected")).toHaveLength(1);
    await rejects(trust.set(f.checkout, true, 0), /revision/);
    expect(
      await repository.read(
        LanguageTrustScope.cases.Workspace.make({ hostId: f.hostId, workspaceId: f.workspaceId })
      )
    ).not.toBeNull();
    const otherHost = createExecutionTrust({ ...options, hostId: HostId.make("other-host") });
    expect((await otherHost.inspect(f.checkout)).trust.trusted).toBe(false);
  } finally {
    await f.cleanup();
  }
});

test("a stored grant for another Host cannot authorize execution even with the same root", async () => {
  const f = await fixture();

  try {
    const record = TrustRecord.make({
      canonicalRoot: f.root,
      trust: {
        scope: LanguageTrustScope.cases.Workspace.make({
          hostId: HostId.make("other-host"),
          workspaceId: f.workspaceId,
        }),
        trusted: true,
        revision: 1,
      },
    });

    const trust = createExecutionTrust({
      hostId: f.hostId,
      registry: f.registry,
      authorizeGrant: async () => {},
      repository: { read: async () => record, compareAndSet: async () => false },
    });

    let invoked = false;
    await rejects(
      trust.execute(f.checkout, async () => {
        invoked = true;
      }),
      /scope does not match/
    );
    expect(invoked).toBe(false);
  } finally {
    await f.cleanup();
  }
});
