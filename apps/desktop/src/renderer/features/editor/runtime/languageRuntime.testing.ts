import { strict as assert } from "node:assert";
import { pathToFileURL } from "node:url";
import { coordinatorFixture } from "../lsp/coordinator.testing.ts";
import { LanguageQueries } from "../lsp/queries.ts";
import { createFakeFiles } from "../files/fake.ts";
import { configureEditor } from "./buffers.ts";

const f = coordinatorFixture();

const file = f.open("installed.sh");

await f.settled(file);

const queries = new LanguageQueries(f.coordinator);

configureEditor({
  languages: f.coordinator,
  languageRuntime: { coordinator: f.coordinator, queries },
  files: createFakeFiles(),
  kv: null,
  prefs: () => ({ vim: false, autosave: false }),
  hostLabel: () => "fixture",
  hostHome: () => null,
  canWrite: () => false,
});

try {
  const url = pathToFileURL(`${import.meta.dirname}/app.ts`).href;

  // SAFETY: The URL targets this checkout's app.ts; only its module cache key changes.
  const reloaded = (await import(`${url}?recheck-reload`)) as typeof import("./app.ts");
  assert.equal(reloaded.editorLanguages, null);
  const owner = reloaded.getEditorLanguages();
  assert.equal(owner, f.coordinator);
  assert.ok(owner);
  await owner.recheck(file.key);
  assert.equal(f.requests.filter((method) => method === "languages.discover").length, 2);
  assert.equal(file.text(), "export const value = 42;");
  console.log("reloaded runtime rechecks through the original open-buffer coordinator");
} finally {
  f.coordinator.dispose();
}
