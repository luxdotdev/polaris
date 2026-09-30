import { describe, expect, test } from "bun:test";
import { usageChangeAction } from "./indexing.ts";

describe("usageChangeAction", () => {
  test("a long pass is announced, then its empty end marker asks for a query at once", () => {
    expect(usageChangeAction({ indexing: true, buckets: [] })).toBe("indexing");
    expect(usageChangeAction({ indexing: false, buckets: [] })).toBe("requery-now");
  });

  test("a short pass with buckets re-queries after a quiet moment", () => {
    expect(usageChangeAction({ indexing: false, buckets: [{}] })).toBe("requery-soon");
  });
});
