import { expect, test } from "bun:test";

test("settling assertions", async () => {
  const failing = Promise.reject(new Error("no"));
  const passing = Promise.resolve(1);

  expect(failing).rejects.toThrow("no");
  expect(passing).resolves.toBe(1);
  expect(passing).resolves.not.toBe(2);

  await expect(failing).rejects.toThrow("no");
  await Promise.all([expect(passing).resolves.toBe(1)]);
  expect(1).toBe(1);
});
