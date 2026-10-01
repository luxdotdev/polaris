import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { DomainEvent, SessionId } from "@polaris/protocol";
import { revokeMcpBindings } from "./revoke.ts";
import { Effect } from "effect";
import { McpTokens } from "./tokens.ts";
import { leadBinding, workerBinding } from "./testing.ts";

test("only token hashes persist; restart keeps credentials and revocation", async () => {
  const root = mkdtempSync("/tmp/polaris-mcp-");
  const path = join(root, "tokens.sqlite");

  try {
    const issued = await Effect.runPromise(
      Effect.gen(function* () {
        const tokens = yield* McpTokens;
        const worker = yield* tokens.issue(workerBinding);
        const lead = yield* tokens.issue(leadBinding);
        expect(worker).toMatch(/^[a-f0-9]{64}$/);
        expect(yield* tokens.authenticate(worker)).toEqual(workerBinding);
        expect(yield* tokens.authenticate("bad-token")).toBeNull();
        expect(yield* tokens.authenticate("0".repeat(64))).toBeNull();

        return { worker, lead };
      }).pipe(Effect.provide(McpTokens.layer(path)))
    );

    const disk = readFileSync(path);
    expect(disk.includes(Buffer.from(issued.worker))).toBe(false);
    expect(disk.includes(Buffer.from(issued.lead))).toBe(false);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    await Effect.runPromise(
      Effect.gen(function* () {
        const tokens = yield* McpTokens;
        expect(yield* tokens.authenticate(issued.worker)).toEqual(workerBinding);
        yield* tokens.revokeAttempt(workerBinding.attemptId);
        expect(yield* tokens.authenticate(issued.worker)).toBeNull();
        expect(yield* tokens.authenticate(issued.lead)).toEqual(leadBinding);
        yield* tokens.revokeSession(leadBinding.sessionId);
      }).pipe(Effect.provide(McpTokens.layer(path)))
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const tokens = yield* McpTokens;
        expect(yield* tokens.authenticate(issued.lead)).toBeNull();
        expect(yield* tokens.authenticate(issued.worker)).toBeNull();
      }).pipe(Effect.provide(McpTokens.layer(path)))
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("committed lifecycle events revoke only matching bindings and replay safely", async () => {
  const root = mkdtempSync("/tmp/polaris-mcp-events-");

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const tokens = yield* McpTokens;
        const worker = yield* tokens.issue(workerBinding);
        const lead = yield* tokens.issue(leadBinding);

        const settled = DomainEvent.cases.AttemptSettled.make({
          constellationId: workerBinding.constellationId,
          attemptId: workerBinding.attemptId,
          attemptRevision: 2,
          revision: 4,
          outcome: "failed",
          reason: "Harness failed",
        });

        yield* revokeMcpBindings(settled);
        yield* revokeMcpBindings(settled);
        expect(yield* tokens.authenticate(worker)).toBeNull();
        expect(yield* tokens.authenticate(lead)).toEqual(leadBinding);
        yield* revokeMcpBindings(
          DomainEvent.cases.LeadChanged.make({
            constellationId: leadBinding.constellationId,
            revision: 5,
            from: leadBinding.sessionId,
            to: SessionId.make("new-lead"),
            summary: "Continue",
          })
        );
        expect(yield* tokens.authenticate(lead)).toBeNull();
        const archived = yield* tokens.issue(workerBinding);
        yield* revokeMcpBindings(
          DomainEvent.cases.SessionStateChanged.make({
            sessionId: workerBinding.sessionId,
            state: "archived",
            reason: null,
          })
        );
        expect(yield* tokens.authenticate(archived)).toBeNull();
        const archivedGraph = yield* tokens.issue(leadBinding);
        yield* revokeMcpBindings(
          DomainEvent.cases.ConstellationStateChanged.make({
            constellationId: leadBinding.constellationId,
            revision: 6,
            state: "archived",
          })
        );
        expect(yield* tokens.authenticate(archivedGraph)).toBeNull();
      }).pipe(Effect.provide(McpTokens.layer(join(root, "tokens.sqlite"))))
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
