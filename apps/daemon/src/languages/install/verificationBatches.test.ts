import { expect, test } from "bun:test";
import { verificationBatches } from "./verificationBatches.ts";

test("verification bounds descriptor count and buffers without omitting or reordering files", () => {
  const mib = 1024 * 1024;

  const files = [
    ...Array.from({ length: 70 }, (_, index) => ({ path: `small-${index}`, size: 1024 })),
    { path: "large-node", size: 116 * mib },
    ...Array.from({ length: 9 }, (_, index) => ({ path: `medium-${index}`, size: 4 * mib })),
  ];

  const batches = [...verificationBatches(files)];

  expect(batches.flat()).toEqual(files);

  for (const batch of batches) {
    expect(batch.length).toBeLessThanOrEqual(32);

    if (batch.length > 1)
      expect(batch.reduce((sum, file) => sum + file.size, 0)).toBeLessThanOrEqual(16 * mib);
  }

  expect(batches.find((batch) => batch.some((file) => file.path === "large-node"))).toEqual([
    files[70]!,
  ]);
  expect([...verificationBatches([])]).toEqual([]);
});
