import assert from "node:assert/strict";
import { Schema } from "effect";
import type { Page } from "../../../apps/desktop/node_modules/playwright-core/index.js";
import { verifyLiveFeed } from "../../../apps/desktop/src/renderer/features/settings/languages/feed.regression.testing.ts";

const Facts = Schema.Array(Schema.String);

export const settings = async (page: Page, output: string) => {
  await page.getByRole("button", { name: "Configure language integrations" }).click();
  await page.getByRole("heading", { name: "Language integrations", exact: true }).waitFor();
  await page.getByLabel("Language", { exact: true }).selectOption("python");
  await page
    .getByLabel("Checkout for discovery and trust")
    .selectOption("fake-0:worktree:fake-worktree");
  await page.getByText("This worktree inherits its workspace's trust.", { exact: false }).waitFor();
  await verifyLiveFeed(page, output);

  return {
    assertions: "Existing verifyLiveFeed, including verifyConfirmedPolicy",
    socketEvidence: false,
  };
};

export const editor = async (page: Page) => {
  await page.waitForFunction("window.languageProof !== undefined");

  const proof = Schema.decodeUnknownSync(
    Schema.Struct({
      facts: Facts,
      requests: Facts,
      notifications: Schema.Number,
    })
  )(await page.evaluate("window.languageProof.run()"));

  const cleanup = Schema.decodeUnknownSync(
    Schema.Struct({
      watches: Schema.Number,
      contexts: Schema.Number,
      subscriptions: Schema.Number,
    })
  )(await page.evaluate("window.languageProof.cleanup()"));

  assert.deepEqual(cleanup, { watches: 0, contexts: 0, subscriptions: 0 });

  return { proof, cleanup, socketEvidence: false };
};

export const resources = async (page: Page) => {
  await page.waitForFunction("window.resourceProof !== undefined");

  const facts = [
    ...Schema.decodeUnknownSync(Facts)(await page.evaluate("window.resourceProof.collision()")),
  ];

  await page.evaluate("window.resourceProof.offer()");
  await page.getByText("1. create file:///checkout/created", { exact: true }).waitFor();
  const body = await page.locator("body").innerText();

  for (const operation of ["1. create", "2. rename", "3. delete", "Preserved original draft"])
    assert.ok(body.includes(operation), operation);
  await page.getByRole("button", { name: "Accept refactor", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "partial:" }).waitFor();
  facts.push(
    ...Schema.decodeUnknownSync(Facts)(await page.evaluate("window.resourceProof.accepted(true)"))
  );
  await page.getByRole("button", { name: "Recover file operations", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "restored:" }).waitFor();
  facts.push(
    ...Schema.decodeUnknownSync(Facts)(
      await page.evaluate('window.resourceProof.restored("recover")')
    )
  );
  await page.evaluate("window.resourceProof.offer(true)");
  await page.getByRole("button", { name: "Accept refactor", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "applied:" }).waitFor();
  facts.push(
    ...Schema.decodeUnknownSync(Facts)(await page.evaluate("window.resourceProof.accepted(false)"))
  );
  await page.getByRole("button", { name: "Undo refactor", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "restored:" }).waitFor();
  facts.push(
    ...Schema.decodeUnknownSync(Facts)(await page.evaluate('window.resourceProof.restored("undo")'))
  );
  await page.waitForFunction("window.jointDiscard !== undefined");
  const discard = Schema.decodeUnknownSync(Facts)(await page.evaluate("window.jointDiscard.run()"));
  await page.getByRole("alert").filter({ hasText: "Cannot preserve the draft" }).waitFor();

  return { facts, discard, socketEvidence: false, crashEvidence: false };
};
