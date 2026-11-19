import { expect, test } from "bun:test";
import { timeStream, warmUp } from "./streamTiming.testing.tsx";

test("a long streamed answer renders each chunk inside a frame", async () => {
  // The highlighter's chunk and languages load first; one untimed pass settles the JIT.
  await warmUp();
  timeStream();
  const result = timeStream();

  console.log(`stream timing ${JSON.stringify(result)}`);
  expect(result.p95).toBeLessThan(8);
}, 30_000);
