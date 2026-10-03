import { expect, test } from "bun:test";
import { ProcessBudget } from "./process-budget.ts";
import { memoryPort } from "../transport/fixture.testing.ts";

test("launch reservations retain capacity through retiring process cleanup", async () => {
  const budget = new ProcessBudget();
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
