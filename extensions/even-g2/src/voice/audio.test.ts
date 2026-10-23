import { expect, test } from "bun:test";
import { audioFeed } from "./audio.ts";

test("keeps frames pushed before reading, waits for more, and ends when told", async () => {
  const feed = audioFeed();
  const read: Array<number> = [];

  feed.push(new Uint8Array([1]));

  const reading = (async () => {
    for await (const frame of feed) read.push(frame[0] ?? -1);
  })();

  await Bun.sleep(5);
  feed.push(new Uint8Array([2]));
  feed.end();
  feed.push(new Uint8Array([3]));
  await reading;

  expect(read).toEqual([1, 2]);
});
