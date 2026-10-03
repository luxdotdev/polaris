import { expect, test } from "bun:test";
import { HostId } from "@polaris/protocol";
import { Effect, Exit } from "effect";
import { ConnectionLanguageLifetime } from "./languageConnectionLifetime.ts";

const principal = Object.freeze({ hostId: HostId.make("host"), clientId: "client" });

test("only exact independently current principal can register; sealed lifetimes refuse new work", async () => {
  let current: typeof principal | null = principal;
  const lifetime = new ConnectionLanguageLifetime(() => current);
  let calls = 0;
  const cleanup = () => Effect.sync(() => calls++).pipe(Effect.asVoid);

  expect(
    Exit.isFailure(await Effect.runPromiseExit(lifetime.attach({ ...principal }, cleanup)))
  ).toBe(true);
  await Effect.runPromise(lifetime.attach(principal, cleanup));
  await Effect.runPromise(lifetime.attach(principal, cleanup));
  current = null;
  lifetime.seal();
  expect(Exit.isFailure(await Effect.runPromiseExit(lifetime.attach(principal, cleanup)))).toBe(
    true
  );
  await Effect.runPromise(lifetime.close());
  await Effect.runPromise(lifetime.close());
  expect(calls).toBe(1);
});

test("close seals before held cleanup settles, awaits cleanup and drains later callbacks after a defect", async () => {
  const lifetime = new ConnectionLanguageLifetime(() => principal);
  const events: string[] = [];

  let release = () => {};

  const held = new Promise<void>((resolve) => {
    release = resolve;
  });

  await Effect.runPromise(lifetime.attach(principal, () => Effect.die("private detail")));
  await Effect.runPromise(
    lifetime.attach(principal, () =>
      Effect.promise(async () => {
        events.push("started");
        await held;
        events.push("finished");
      })
    )
  );

  const closing = Effect.runPromise(lifetime.close());

  await Promise.resolve();
  expect(
    Exit.isFailure(await Effect.runPromiseExit(lifetime.attach(principal, () => Effect.void)))
  ).toBe(true);
  expect(events).toEqual(["started"]);
  release();
  await closing;
  expect(events).toEqual(["started", "finished"]);
});

test("registration is bounded and replacement authority cannot register on the old owner", async () => {
  let current = principal;
  const lifetime = new ConnectionLanguageLifetime(() => current);

  for (let index = 0; index < 1024; index++)
    await Effect.runPromise(lifetime.attach(principal, () => Effect.void));

  expect(
    Exit.isFailure(await Effect.runPromiseExit(lifetime.attach(principal, () => Effect.void)))
  ).toBe(true);
  current = { ...principal };
  expect(
    Exit.isFailure(await Effect.runPromiseExit(lifetime.attach(principal, () => Effect.void)))
  ).toBe(true);
  await Effect.runPromise(lifetime.close());
});
