import { expect, test } from "bun:test";
import { acquire, close, context, fakeLanguages, open, release } from "./pages.fixture.testing.ts";
import { LanguagePage } from "./pages.ts";

const a = "file:///repo/a.ts";

test("a page that goes closes the documents it opened and releases its interests", async () => {
  const { api, calls } = fakeLanguages([
    { uri: a, version: 4 },
    { uri: "file:///repo/other.ts", version: 1 },
  ]);

  const page = new LanguagePage();

  await page.request(api, "languages.context.acquire", acquire);
  await page.request(api, "languages.document.sync", open(a));
  calls.length = 0;
  await page.cleanup(api);

  expect(calls.map((call) => call.method)).toEqual([
    "languages.context.acquire",
    "languages.document.sync",
    "languages.context.release",
    "languages.context.release",
  ]);
  // The Daemon's current sequence and version, and only this page's document.
  expect(calls[1]?.input).toMatchObject({
    context,
    sequence: 8,
    notification: { uri: a, version: 4 },
  });
  const probe = calls[0]?.input;
  expect(calls.slice(2).map((call) => call.input)).toMatchObject([
    { interestId: "editor-page" },
    { interestId: probe !== undefined && "interestId" in probe ? probe.interestId : "" },
  ]);
});

test("released interests and closed documents are left alone", async () => {
  const { api, calls } = fakeLanguages([]);
  const page = new LanguagePage();

  await page.request(api, "languages.context.acquire", acquire);
  await page.request(api, "languages.document.sync", open(a));
  await page.request(api, "languages.document.sync", close(a));
  await page.request(api, "languages.context.release", release);
  calls.length = 0;
  await page.cleanup(api);

  expect(calls).toEqual([]);
});
