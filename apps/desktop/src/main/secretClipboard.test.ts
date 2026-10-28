import { expect, test } from "bun:test";
import {
  SECRET_CLIPBOARD_MS,
  SECRET_MARKERS,
  type SystemClipboard,
  writeSecret,
} from "./secretClipboard.ts";

/** A pasteboard: the current entry's formats, and the history a clipboard manager would keep. */
const fake = () => {
  let entry: Readonly<Record<string, string>> = {};
  const history: Array<string> = [];

  const clipboard: SystemClipboard = {
    readText: () => entry["text/plain"] ?? "",
    write: async (next) => {
      entry = next;

      // What Maccy, Raycast and Alfred do: concealed or transient entries aren't kept.
      if (!SECRET_MARKERS.some((format) => format in next)) history.push(next["text/plain"] ?? "");
    },
    clear: () => {
      entry = {};
    },
  };

  return { clipboard, read: () => entry["text/plain"] ?? "", history };
};

test("a copied secret is cleared after a minute and never enters clipboard history (RV5)", async () => {
  const { clipboard, read, history } = fake();
  const timers: Array<{ run: () => Promise<void>; ms: number }> = [];

  await writeSecret(clipboard, "polaris-link:v2:abc", (run, ms) => timers.push({ run, ms }));
  expect(read()).toBe("polaris-link:v2:abc");
  expect(history).toEqual([]);

  await timers[0]?.run();
  expect(timers[0]?.ms).toBe(SECRET_CLIPBOARD_MS);
  expect(read()).toBe("");
});

test("something the user copied since is left alone", async () => {
  const { clipboard, read } = fake();
  const timers: Array<() => Promise<void>> = [];

  await writeSecret(clipboard, "polaris-link:v2:abc", (run) => timers.push(run));
  await clipboard.write({ "text/plain": "git status" });
  await timers[0]?.();

  expect(read()).toBe("git status");
});
