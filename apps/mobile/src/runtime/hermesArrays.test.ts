import { expect, test } from "bun:test";
import { join } from "node:path";

/** ES2023's copying array methods: the app's Hermes has none of them, so a call throws at runtime. */
const MISSING = /\.(toSorted|toReversed|toSpliced)\(/;

test("app code never calls an array method the app's Hermes lacks", async () => {
  const src = join(import.meta.dir, "..");
  const offenders: Array<string> = [];

  for await (const file of new Bun.Glob("**/*.{ts,tsx}").scan(src)) {
    if (/\.(test|testing)\.tsx?$/.test(file)) continue;

    const lines = (await Bun.file(join(src, file)).text()).split("\n");

    lines.forEach((line, index) => {
      if (MISSING.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line))
        offenders.push(`${file}:${index + 1}`);
    });
  }

  expect(offenders).toEqual([]);
});
