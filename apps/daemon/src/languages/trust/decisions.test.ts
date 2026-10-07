import { expect, test } from "bun:test";
import { rejects } from "node:assert/strict";
import { join } from "node:path";
import { fixture } from "../discovery/fixture.ts";
import { createExecutionTrust, createFileTrustRepository } from "./index.ts";

test("all decisions and the bundled override persist; Worktrees inherit and Reviews stay separate", async () => {
  const f = await fixture();

  try {
    const make = () =>
      createExecutionTrust({
        hostId: f.hostId,
        registry: f.registry,
        repository: createFileTrustRepository(join(f.temporary, "decisions")),
        authorizeGrant: async () => {},
      });

    let trust = make();
    expect((await trust.inspect(f.checkout)).trust.decision).toBe("undecided");
    await trust.change(f.checkout, "decline", 0);
    trust = make();
    expect((await trust.inspect(f.treeCheckout)).trust.decision).toBe("declined");
    expect(trust.claimAsk((await trust.inspect(f.checkout)).trust)).toBe(false);
    await trust.change(f.checkout, "ask-again", 1);
    const undecided = (await trust.inspect(f.checkout)).trust;
    expect(trust.claimAsk(undecided)).toBe(true);
    expect(trust.claimAsk(undecided)).toBe(false);
    await trust.change(f.checkout, "trust", 2);
    await trust.change(f.checkout, "use-bundled", 3);
    trust = make();
    expect((await trust.inspect(f.treeCheckout)).trust).toMatchObject({
      decision: "trusted",
      trusted: true,
      typescriptProvider: "bundled",
      revision: 4,
    });
    expect((await trust.inspect(f.reviewCheckout)).trust.decision).toBe("undecided");
    await rejects(trust.change(f.checkout, "use-project", 3), { reason: "conflict" });
    await trust.change(f.checkout, "use-project", 4);
    await trust.change(f.checkout, "revoke", 5);
    expect((await make().inspect(f.checkout)).trust).toMatchObject({
      decision: "declined",
      trusted: false,
      typescriptProvider: "project",
      revision: 6,
    });
  } finally {
    await f.cleanup();
  }
});
