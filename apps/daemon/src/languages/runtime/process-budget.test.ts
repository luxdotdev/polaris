import { expect, test } from "bun:test";
import { ProcessBudget } from "./process-budget.ts";
import { memoryPort } from "../transport/fixture.testing.ts";

test("launch reservations retain capacity through retiring process cleanup", async () => {
  const budget = new ProcessBudget(8);
  const reservations = Array.from({ length: 8 }, () => budget.reserve());
  expect(() => budget.reserve()).toThrow();
  let finish: (() => void) | undefined;

  const stopped = new Promise<void>((resolve) => {
    finish = resolve;
  });

  const port = reservations[0]!.spawn(() => ({ ...memoryPort().port, stop: () => stopped }));
  reservations[0]!.releaseUnstarted();
  const cleanup = port.stop();
  expect(() => budget.reserve()).toThrow();
  finish?.();
  await cleanup;
  await port.stop();
  expect(budget.used).toBe(7);

  for (const reservation of reservations) reservation.releaseUnstarted();
  expect(budget.used).toBe(0);
  const failed = budget.reserve();
  expect(() =>
    failed.spawn(() => {
      throw new Error("spawn failed");
    })
  ).toThrow();
  failed.releaseUnstarted();
  expect(budget.used).toBe(0);
});

test("failed teardown retains capacity and lowering/increasing limits never kills or forgets a held server", async () => {
  const budget = new ProcessBudget(2);
  const active = budget.reserve();
  const retiring = budget.reserve();

  const port = retiring.spawn(() => ({
    ...memoryPort().port,
    stop: () => Promise.reject(new Error("owned stop failed")),
  }));

  const failed = await port.stop().then(
    () => null,
    (cause: unknown) => cause
  );

  expect(failed).toMatchObject({ message: "owned stop failed" });
  budget.setLimit(1);
  expect(budget.used).toBe(2);
  expect(budget.retiring).toBe(true);
  expect(() => budget.reserve()).toThrow();
  expect(() => budget.setLimit(0)).toThrow();
  expect(budget.limit).toBe(1);
  const signal = new AbortController();
  const changed = budget.wait(signal.signal);
  budget.setLimit(3);
  await changed;
  const third = budget.reserve();
  third.releaseUnstarted();
  active.releaseUnstarted();
  expect(budget.used).toBe(1);
});
