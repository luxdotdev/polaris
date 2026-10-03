import { posix } from "node:path";

/** Reuse fixture containers and scripts while sharing one Vite origin/root. */
export const fixtureHtml = (source: string, fixturePath: string, nativeDiscard: boolean) => {
  const directory = posix.dirname(fixturePath);
  const rewritten = source.replaceAll('src="/', `src="/${directory}/`);

  return nativeDiscard
    ? rewritten.replace(
        "</body>",
        '<script type="module" src="/tooling/language-fixtures/joint/native-discard.testing.ts"></script></body>'
      )
    : rewritten;
};
