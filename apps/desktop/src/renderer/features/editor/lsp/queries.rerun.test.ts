import { expect, test } from "bun:test";
import type { EditorLanguageCoordinator } from "./integration.ts";
import { LanguageQueries } from "./queries.ts";
import { languagePatch, languageStore, type LanguageViewState } from "./state.ts";

const file: LanguageViewState = {
  language: "typescript",
  manual: null,
  status: "ready",
  fact: "",
  providers: ["typescript-language-server"],
  panel: null,
  rows: [],
  busy: false,
};

test("a panel cleared by a provider swap asks the replacement once it is ready", async () => {
  const coordinator: Pick<EditorLanguageCoordinator, "get"> = { get: () => undefined };

  const queries = new LanguageQueries(
    // SAFETY: LanguageQueries reads only `get`, and this file is unknown to it.
    coordinator as EditorLanguageCoordinator
  );

  const runs: string[] = [];
  languageStore.setState({ files: { a: file } });

  await queries.run("a", "problems");
  languagePatch("a", { panel: "Problems", rows: [] });
  queries.run = async (_key, command) => void runs.push(command);

  // Trust replaced the provider: no providers while the panel waits, then the new one is ready.
  languagePatch("a", { status: "unavailable", busy: true, providers: [] });
  expect(runs).toEqual([]);
  languagePatch("a", { status: "ready", providers: ["typescript-language-server"] });
  expect(runs).toEqual(["problems"]);

  queries.close("a");
  languagePatch("a", { status: "unavailable", busy: true });
  languagePatch("a", { status: "ready" });
  expect(runs).toEqual(["problems"]);
  queries.unwatch();
});
