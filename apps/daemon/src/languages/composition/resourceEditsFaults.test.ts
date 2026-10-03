import { expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fixture } from "../../files/edits/trees/testing.ts";

test("receipt authority revoked after durable forward intent prevents the native move", async () => {
  const f = await fixture();

  try {
    const request = await f.request(f.chain());
    let current = true;

    const api = f.coordinator({
      authorize: async () => {
        if (!current) throw new Error("receipt revoked");
      },
      fault: async (point) => {
        if (point === "intent") current = false;
      },
    });

    const result = await api.accept(f.owner, request.proposal, request.acceptance, request.drafts);
    expect(result.state).toBe("partial");
    await access(join(f.root, "source"));
    expect(await readFile(join(f.root, "target", "original"), "utf8")).toBe("overwritten");
  } finally {
    await f.cleanup();
  }
});

test("recovery passes authoritative receipt to verifier and rechecks after reverse intent", async () => {
  const f = await fixture();

  try {
    const request = await f.request(
      [{ kind: "rename", oldUri: f.uri("source"), newUri: f.uri("final") }],
      ["source", "final"]
    );

    let current = true;
    let expected = 0;
    let verified = 0;

    const api = f.coordinator({
      authorizeRecovery: async (_owner, _operation, intent, outcome) => {
        if (intent === "get" || outcome === undefined) return;
        verified++;
        expect(outcome.receiptRevision).toBe(expected);

        if (!current) throw new Error("reconciliation revoked");
      },
      fault: async (point) => {
        if (point === "restore-intent") current = false;
      },
    });

    const applied = await api.accept(f.owner, request.proposal, request.acceptance, request.drafts);
    expected = applied.receiptRevision;
    const result = await api.recover(f.owner, "operation", expected, "undo");
    expect(verified).toBeGreaterThan(2);
    expect(result.state).toBe("recovery-required");
    await access(join(f.root, "final"));
    expect(await readFile(join(f.root, "final", "nested", "file"), "utf8")).toBe("alpha\r\n");
  } finally {
    await f.cleanup();
  }
});
