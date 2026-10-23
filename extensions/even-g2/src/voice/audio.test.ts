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

test("bounds queued bytes and discards the partial recording on overflow", async () => {
  const feed = audioFeed();

  for (let i = 0; i < 20; i++) expect(feed.push(new Uint8Array(3200))).toBe(true);
  expect(feed.push(new Uint8Array(3200))).toBe(false);
  expect(await Array.fromAsync(feed)).toEqual([]);
});

test("bounds tiny frames and ignores empty ones", async () => {
  const feed = audioFeed();

  for (let i = 0; i < 1000; i++) feed.push(new Uint8Array());

  for (let i = 0; i < 256; i++) expect(feed.push(new Uint8Array([1]))).toBe(true);
  expect(feed.push(new Uint8Array([1]))).toBe(false);
  expect(await Array.fromAsync(feed)).toEqual([]);
});

test("owns buffered bytes and drops them on cancel", async () => {
  const feed = audioFeed();
  const frame = new Uint8Array([1]);
  feed.push(frame);
  frame[0] = 2;
  const iterator = feed[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toEqual(new Uint8Array([1]));
  feed.push(frame);
  feed.cancel();
  expect((await iterator.next()).done).toBe(true);
});
