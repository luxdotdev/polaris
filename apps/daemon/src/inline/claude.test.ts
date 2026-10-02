import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, Result, Stream } from "effect";
import { claudeArgs, claudeInline } from "./claude.ts";
import { propose } from "./proposal.ts";
import { request } from "./testing.ts";

const roots: Array<string> = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const fake = (source: string) => {
  const root = mkdtempSync(join(tmpdir(), "pi-inline-claude-"));
  roots.push(root);

  const binary = join(root, "claude");

  writeFileSync(binary, `#!${process.execPath}\n${source}`);
  chmodSync(binary, 0o755);

  return { root, binary };
};

test("Claude print mode only exposes Read and uses an isolated structured-output request", async () => {
  const patch = { replacements: [{ from: 7, to: 9, text: "replacement" }], summary: "Change" };

  const { root, binary } = fake(`
const input = await Bun.stdin.text();
await Bun.write('input.json', input);
console.log(JSON.stringify({type:'stream_event',event:{delta:{partial_json:'proposal'}}}));
console.log(JSON.stringify({type:'result',subtype:'success',is_error:false,structured_output:${JSON.stringify(patch)}}));
`);

  const items = await Effect.runPromise(
    propose(request(), root, claudeInline(binary)).pipe(Stream.runCollect)
  );

  expect(items).toHaveLength(2);
  expect(items[1]).toMatchObject({ patch });
  expect(await Bun.file(join(root, "input.json")).text()).toContain(
    request().content.replaceAll("\r", "\\r").replaceAll("\n", "\\n")
  );
  const args = claudeArgs("model", "high");

  expect(args.slice(args.indexOf("--tools"), args.indexOf("--tools") + 2)).toEqual([
    "--tools",
    "Read",
  ]);
  expect(args).toContain("--no-session-persistence");
  expect(args).toContain("--restricted");
  expect(args).toContain("--strict-mcp-config");
});

test("cancelling Claude kills the print process", async () => {
  const { root, binary } = fake(`
await Bun.write('started', String(process.pid));
setInterval(() => {}, 1000);
`);

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkScoped(
          propose(request(), root, claudeInline(binary)).pipe(Stream.runDrain)
        );

        while (!(yield* Effect.promise(() => Bun.file(join(root, "started")).exists())))
          yield* Effect.sleep(10);

        const pid = Number(yield* Effect.promise(() => Bun.file(join(root, "started")).text()));
        yield* Fiber.interrupt(fiber);

        expect(() => process.kill(pid, 0)).toThrow();
      })
    )
  );
});

test("Claude exiting before structured output reports a typed Harness failure", async () => {
  const { root, binary } = fake("process.exit(42);");

  const result = await Effect.runPromise(
    propose(request(), root, claudeInline(binary)).pipe(Stream.runCollect, Effect.result)
  );

  expect(Result.isFailure(result) && result.failure.reason).toBe("harness-failed");
});
