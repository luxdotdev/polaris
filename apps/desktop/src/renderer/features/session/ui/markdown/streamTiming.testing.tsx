/**
 * Per-chunk render time of a streamed answer (ENG-971): renders `Streamed` as a long answer
 * arrives in small chunks and prints p50/p95/max. Run with `bun test streamTiming`.
 */
import "../../../../test/dom.testing.ts";
import { TooltipProvider } from "@polaris/ui";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { expect } from "bun:test";
import type { ReactNode } from "react";
import { createStore } from "zustand/vanilla";
import { createCommandRegistry } from "../../../../routes/commands.ts";
import { createNavigation } from "../../../../routes/navigation.ts";
import { AppProvider } from "../../../../shell/hooks.ts";
import { type AppState, initialState } from "../../../../store/store.ts";
import { EditorPlaceProvider } from "../../../editor-links/index.ts";
import Streamed from "./Streamed.tsx";

const Providers = ({ children }: { readonly children: ReactNode }) => {
  const store = createStore<AppState>(() => initialState);

  const connection = {
    store,
    openSession: () => () => undefined,
    setDensity: () => undefined,
    setAppearance: () => undefined,
  };

  return (
    <AppProvider
      value={{
        connection,
        navigation: createNavigation({ app: store, storage: null }),
        commands: createCommandRegistry({ platform: "mac" }),
      }}
    >
      <EditorPlaceProvider value={{ hostKey: "host", root: "/code/repo", windows: false }}>
        <TooltipProvider>{children}</TooltipProvider>
      </EditorPlaceProvider>
    </AppProvider>
  );
};

const SECTION = (n: number) =>
  [
    `## Part ${n}`,
    "",
    `The engine folds events in \`apps/daemon/src/engine/session.ts:${40 + n}\`, then **commits** them`,
    "to the store; a *slow* reader never blocks a writer, and each Turn ends with a checkpoint.",
    "",
    "- first, the command is decided",
    "- then it is committed and acknowledged",
    "- finally the stream fans out to every Client",
    "",
    "| Step | Time | Note |",
    "| --- | ---: | --- |",
    `| decide | ${n}.2 ms | pure |`,
    `| commit | ${n}.9 ms | one write |`,
    "",
    "```ts",
    `export const fold${n} = (events: ReadonlyArray<Event>) =>`,
    "  events.reduce((state, event) => decide(state, event), initial);",
    "```",
    "",
    `The cost grows as $O(n \\log n)$, and $$\\sum_{k=1}^{${n}} k = \\frac{${n}(${n}+1)}{2}$$`,
    "",
  ].join("\n");

export const LONG_ANSWER = Array.from({ length: 12 }, (_, n) => SECTION(n + 1)).join("\n");

/** Renders the whole answer once and waits for the highlighter to colour its code. */
export const warmUp = async () => {
  const view = render(
    <Providers>
      <Streamed text={LONG_ANSWER} live={false} />
    </Providers>
  );

  await waitFor(() => expect(view.container.querySelector("pre .line")).not.toBeNull(), {
    timeout: 10_000,
  });
  cleanup();
};

const percentile = (sorted: ReadonlyArray<number>, p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? 0;

export const timeStream = (chunk = 24) => {
  const times: Array<number> = [];

  const view = render(
    <Providers>
      <Streamed text="" live />
    </Providers>
  );

  for (let end = chunk; end < LONG_ANSWER.length + chunk; end += chunk) {
    const text = LONG_ANSWER.slice(0, end);
    const start = performance.now();

    act(() =>
      view.rerender(
        <Providers>
          <Streamed text={text} live={end < LONG_ANSWER.length} />
        </Providers>
      )
    );
    times.push(performance.now() - start);
  }

  cleanup();
  const sorted = times.toSorted((a, b) => a - b);

  return {
    chunks: times.length,
    chars: LONG_ANSWER.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted.at(-1) ?? 0,
  };
};
