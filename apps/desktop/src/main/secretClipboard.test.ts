import { expect, test } from "bun:test";
import { SECRET_CLIPBOARD_MS, type SystemClipboard, writeSecret } from "./secretClipboard.ts";

const fake = () => {
  let text = "";

  const clipboard: SystemClipboard = {
    readText: () => text,
    writeText: (next) => {
      text = next;
    },
    clear: () => {
      text = "";
    },
  };

  return { clipboard, read: () => text };
};

test("a copied secret is cleared after a minute", async () => {
  const { clipboard, read } = fake();
  const timers: Array<{ run: () => Promise<void>; ms: number }> = [];

  writeSecret(clipboard, "polaris-link:v2:abc", (run, ms) => timers.push({ run, ms }));
  expect(read()).toBe("polaris-link:v2:abc");

  await timers[0]?.run();
  expect(timers[0]?.ms).toBe(SECRET_CLIPBOARD_MS);
  expect(read()).toBe("");
});

test("something the user copied since is left alone", async () => {
  const { clipboard, read } = fake();
  const timers: Array<() => Promise<void>> = [];

  writeSecret(clipboard, "polaris-link:v2:abc", (run) => timers.push(run));
  clipboard.writeText("git status");
  await timers[0]?.();

  expect(read()).toBe("git status");
});
