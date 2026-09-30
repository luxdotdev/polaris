import { describe, expect, test } from "bun:test";
import { type FrameScheduler, frameQueue } from "./frameQueue.ts";

const manualScheduler = () => {
  const frames: Array<() => void> = [];
  const timeouts: Array<() => void> = [];

  const scheduler: FrameScheduler = {
    frame: (run) => frames.push(run),
    timeout: (run) => timeouts.push(run),
  };

  return { scheduler, frames, timeouts };
};

describe("frame queue", () => {
  test("everything pushed before a frame is applied once, in order", () => {
    const applied: Array<ReadonlyArray<number>> = [];
    const { scheduler, frames } = manualScheduler();
    const queue = frameQueue<number>({ apply: (items) => applied.push(items), scheduler });

    queue.push(1);
    queue.push(2);
    queue.push(3);

    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(applied).toEqual([[1, 2, 3]]);
  });

  test("a hidden window (no frames) still flushes on the timeout, once", () => {
    const applied: Array<ReadonlyArray<number>> = [];
    const { scheduler, frames, timeouts } = manualScheduler();
    const queue = frameQueue<number>({ apply: (items) => applied.push(items), scheduler });

    queue.push(1);
    timeouts[0]?.();
    frames[0]?.();
    expect(applied).toEqual([[1]]);
  });
});
