import { expect, test } from "bun:test";
import { CommandId } from "@polaris/protocol";
import { openMic } from "../composer/mic.ts";
import type { DictationCallbacks } from "../composer/voice.ts";
import { startLatch, takePrompt } from "./latch.ts";

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

test("Start while dictating: a late transcript changes neither the field nor the retried command", async () => {
  const box = { field: "Fix the flaky test" };
  const heard: Array<DictationCallbacks> = [];

  const mic = openMic({
    permitted: async () => true,
    startAudio: async () => undefined,
    stopAudio: () => undefined,
    dictate: (callbacks) => {
      heard.push(callbacks);

      return { push: () => undefined, finish: () => undefined, cancel: () => undefined };
    },
    field: () => box.field,
    write: (text) => void (box.field = text),
    changed: () => undefined,
  });

  mic.toggle();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const latch = startLatch(ids());
  const sent: Array<string> = [];

  const start = (fails: boolean) =>
    latch(
      takePrompt(mic, () => box.field),
      async (id) => {
        sent.push(id);

        if (fails) throw new Error("connection lost");
      }
    );

  expect(await start(true).catch((failure: Error) => failure.message)).toBe("connection lost");
  heard[0]?.heard({ finalText: "in the daemon", interimText: "" });
  expect(await start(false)).toBe(true);

  expect(box.field).toBe("Fix the flaky test");
  expect(sent).toEqual(["c1", "c1"]);
});
