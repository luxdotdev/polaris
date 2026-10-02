import { expect, test } from "bun:test";
import { SessionId } from "@polaris/protocol";
import { openUsageDb } from "./db.ts";
import { queryResponses } from "./responses.ts";

test("response reads use exact timestamp and Session boundaries, preserving reported and long-context subsets", () => {
  const db = openUsageDb(":memory:");

  try {
    db.run("INSERT INTO session_map VALUES ('codex', 'native', 'polaris')");

    const insert = db.query(
      "INSERT INTO usage (harness,native,ts,hour,model,input,cache_read,cache_write,output,reasoning,cache_write_1h,context,cost) VALUES ('codex',?, ?,0,'model',10,20,30,40,5,7,300000,?)"
    );

    insert.run("native", 999, 0.1);
    insert.run("native", 1000, 0.2);
    insert.run("native", 1999, null);
    insert.run("native", 2000, 0.3);
    insert.run("unlinked", 1500, 0.4);
    const before = db.query<{ n: number }, []>("SELECT count(*) AS n FROM usage").get()?.n;

    const rows = queryResponses(db, {
      from: new Date(1000).toISOString(),
      to: new Date(2000).toISOString(),
      sessionIds: [SessionId.make("polaris")],
    });

    expect(rows.map((r) => Date.parse(r.at))).toEqual([1000, 1999]);
    expect(rows[0]?.bucket.tokens).toMatchObject({
      input: 10,
      cacheRead: 20,
      cacheWrite: 30,
      output: 40,
      reasoning: 5,
      cacheWrite1h: 7,
    });
    expect(rows[0]?.bucket.reportedCost?.usd).toBe(0.2);
    expect(rows[1]?.bucket.reportedCost).toBeNull();
    expect(rows[0]?.bucket.longContext.map((l) => l.above)).toEqual([200000, 272000]);
    expect(db.query<{ n: number }, []>("SELECT count(*) AS n FROM usage").get()?.n).toBe(before);
    expect(
      queryResponses(db, {
        from: new Date(0).toISOString(),
        to: new Date(3000).toISOString(),
        sessionIds: [],
      })
    ).toEqual([]);
  } finally {
    db.close();
  }
});
