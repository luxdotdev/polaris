import { expect, test } from "bun:test";
import { Attempt, Constellation } from "@polaris/protocol";
import { Struct } from "effect";
import { A, claimed, draft, report } from "../engine/constellation.testing.ts";
import { statusOutline } from "./status.ts";

test("status keeps only the latest rejected Claim with three indented feedback lines", () => {
  const record = claimed();

  const old = Attempt.make(
    Struct.assign(draft(A, "old"), {
      state: "rejected" as const,
      claim: report("branch", "old-head"),
      rejectionReason: "Old feedback",
    })
  );

  const latest = Attempt.make(
    Struct.assign(draft(A, "latest"), {
      state: "rejected" as const,
      claim: report("branch", "latest-head"),
      rejectionReason: "one\ntwo\nthree\nfour\nfive",
    })
  );

  const graph = Constellation.make(
    Struct.assign(record.graph, { attempts: [old, latest, draft(A, "current")] })
  );

  const text = statusOutline({ ...record, graph });

  expect(text).toContain("Claim latest-head");
  expect(text).toContain("  Review feedback:\n    one\n    two\n    three\n    …");
  expect(text).not.toContain("old-head");
  expect(text).not.toContain("four");
  expect(graph.attempts[1]!.rejectionReason).toBe("one\ntwo\nthree\nfour\nfive");
});
