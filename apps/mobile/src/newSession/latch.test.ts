import { expect, test } from "bun:test";
import { CommandId } from "@polaris/protocol";
import { startLatch } from "./latch.ts";

const ids = () => {
  let n = 0;

  return () => CommandId.make(`c${++n}`);
};

const held = () => {
  let release: () => void = () => undefined;
  let fail: (failure: Error) => void = () => undefined;

  const promise = new Promise<void>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });

  return { promise, release, fail };
};

test("a second tap before the first Start is answered sends nothing", async () => {
  const latch = startLatch(ids());
  const sent: Array<string> = [];
  const answer = held();

  const send = (id: CommandId) => {
    sent.push(id);

    return answer.promise;
  };

  const first = latch("same", send);
  const second = latch("same", send);

  answer.release();

  expect(await Promise.all([first, second])).toEqual([true, false]);
  expect(sent).toEqual(["c1"]);
  expect(await latch("same", send)).toBe(false);
  expect(sent).toEqual(["c1"]);
});

test("after a failed Start, a retry of the same choices keeps its command id; new choices don't", async () => {
  const latch = startLatch(ids());
  const sent: Array<string> = [];

  const failing = (id: CommandId) => {
    sent.push(id);

    return Promise.reject(new Error("connection lost"));
  };

  const outcome = (key: string) =>
    latch(key, failing).then(
      () => "sent",
      (failure: Error) => failure.message
    );

  expect(await outcome("prompt A")).toBe("connection lost");
  expect(await outcome("prompt A")).toBe("connection lost");
  expect(await outcome("prompt B")).toBe("connection lost");

  expect(sent).toEqual(["c1", "c1", "c2"]);
});
