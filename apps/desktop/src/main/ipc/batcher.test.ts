import { describe, expect, test } from "bun:test";
import type { BatchEntry } from "../../shared/api.ts";
import { newBatcher } from "./batcher.ts";

const collect = () => {
  const sent: Array<ReadonlyArray<BatchEntry>> = [];

  return { sent, batcher: newBatcher({ send: (entries) => sent.push(entries), windowMs: 1 }) };
};

describe("batcher", () => {
  test("coalesces every subscription's items into one message per window", async () => {
    const { sent, batcher } = collect();

    for (let i = 0; i < 100; i++) batcher.push(1, i);
    batcher.push(2, "a");
    await Bun.sleep(5);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.map((e) => [e.id, e.items.length])).toEqual([
      [1, 100],
      [2, 1],
    ]);
  });

  test("an end travels after the feed's last items, in the same message", () => {
    const { sent, batcher } = collect();

    batcher.push(1, "last");
    batcher.end(1, { code: "NotFound", message: "no such session" });
    batcher.flush();

    expect(sent).toEqual([
      [{ id: 1, items: ["last"], end: { code: "NotFound", message: "no such session" } }],
    ]);
  });

  test("nothing is sent after dispose", async () => {
    const { sent, batcher } = collect();

    batcher.push(1, "x");
    batcher.dispose();
    batcher.push(1, "y");
    await Bun.sleep(5);

    expect(sent).toEqual([]);
  });
});
