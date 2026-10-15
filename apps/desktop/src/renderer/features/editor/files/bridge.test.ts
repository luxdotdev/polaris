import { afterEach, describe, expect, test } from "bun:test";
import { EDITOR_FILE_MAX_BYTES } from "@polaris/protocol";
import type { PolarisApi } from "../../../../shared/api.ts";
import { standInBridge } from "../../bridge.ts";
import { createBridgeFiles } from "./bridge.ts";

afterEach(() => standInBridge(null));

type Answer =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

/** Answers requests by method, recording each one sent. */
const host = (answers: Readonly<Record<string, Answer>>) => {
  const sent: Array<string> = [];

  standInBridge({
    request: (method, _input) => {
      sent.push(method);
      const answer = answers[method] ?? { ok: false, error: { code: "Unknown", message: method } };

      // SAFETY: each test answers its methods with the shapes `bridge.ts` reads.
      return Promise.resolve(answer) as never;
    },
    subscribe: () => () => undefined,
    onAppEvent: () => () => undefined,
  } satisfies PolarisApi);

  return sent;
};

const target = { hostKey: "local", path: "/code/polaris/huge.log", root: "/code/polaris" };

describe("a file over the editor limit", () => {
  test("the Daemon's EFBIG refusal reads as too large, not as an error", async () => {
    host({
      "files.readVersioned": {
        ok: false,
        error: { code: "FileError", message: "EFBIG: 8589934592 bytes is too large to open" },
      },
    });

    const files = createBridgeFiles(() => true);

    expect(await files.read(target)).toEqual({ kind: "too-large" });
  });

  test("an older Daemon is never asked to read it whole", async () => {
    const sent = host({
      "files.stat": {
        ok: true,
        value: {
          name: "huge.log",
          path: target.path,
          kind: "file",
          size: EDITOR_FILE_MAX_BYTES + 1,
          modifiedAt: "2026-10-01T00:00:00.000Z",
        },
      },
    });

    const files = createBridgeFiles(() => false);

    expect(await files.read(target)).toEqual({ kind: "too-large" });
    expect(sent).toEqual(["files.stat"]);
  });
});
