import { strict as assert } from "node:assert";
import type { Page } from "playwright-core";
import { Schema } from "effect";

const snapshot = async (page: Page) =>
  Schema.decodeUnknownSync(
    Schema.Struct({
      calls: Schema.Array(Schema.String),
      pending: Schema.Array(Schema.String),
      revision: Schema.Number,
      interpreter: Schema.String,
    })
  )(
    await page.evaluate(
      "({calls:window.regression.calls,pending:window.regression.pending(),revision:window.regression.read().revision,interpreter:window.regression.read().settings.interpreter ?? ''})"
    )
  );

const noHostAuthority = async (page: Page) => {
  const buttons = page.getByRole("button", {
    name: /^(Install|Retry|Restart|Roll back|Update|Cancel installation|Open logs|Trust this checkout|Reconnect host|Upgrade daemon|Open host settings)/,
  });

  const count = await buttons.count();

  assert(count > 0);

  for (let i = 0; i < count; i += 1) assert.equal(await buttons.nth(i).isDisabled(), true);
  assert.equal(
    await page.getByRole("button", { name: "Save language settings", exact: true }).isDisabled(),
    true
  );
};

export const verifyAdapterAuthorityRegression = async (page: Page) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.evaluate("window.regression.activate()");
  await page.getByLabel("Find host or tool", { exact: true }).fill("");
  await page.getByRole("heading", { name: "first · Fake host 5", exact: true }).waitFor();

  await page.evaluate(
    "window.regression.control.load.replacement='failed';window.regression.swap()"
  );
  await page.getByRole("alert").filter({ hasText: "replacement facts unavailable" }).waitFor();
  await noHostAuthority(page);
  await page.getByRole("status").filter({ hasText: "Last-known facts" }).waitFor();
  await page
    .getByLabel("Interpreter override on host", { exact: true })
    .fill("/fixture/retained-draft");
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/retained-draft"
  );
  await noHostAuthority(page);
  await page.evaluate("window.regression.control.load.replacement='wrong-scope'");
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "another scope" }).waitFor();
  await noHostAuthority(page);
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/retained-draft"
  );
  await page.evaluate("window.regression.control.load.replacement='ok'");
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page.getByRole("heading", { name: "replacement · Fake host 5", exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/retained-draft"
  );
  assert.equal(
    await page.getByRole("button", { name: "Save language settings", exact: true }).isEnabled(),
    true
  );
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.getByRole("button", { name: "Install", exact: true }).click();
  assert((await snapshot(page)).calls.includes("act:replacement:install"));

  await page.evaluate("window.regression.control.load.first='hold';window.regression.activate()");
  await page.getByRole("button", { name: "Cancel request", exact: true }).waitFor();
  await noHostAuthority(page);
  await page.evaluate("window.regression.swap()");
  await page
    .getByRole("button", { name: "Cancel request", exact: true })
    .waitFor({ state: "hidden" });
  await page.getByRole("heading", { name: "replacement · Fake host 5", exact: true }).waitFor();
  await page.evaluate("window.regression.complete('load:first')");
  assert.equal(
    await page.getByRole("heading", { name: "first · Fake host 5", exact: true }).count(),
    0
  );
  assert.equal(await page.getByRole("button", { name: "Install", exact: true }).isEnabled(), true);

  return snapshot(page);
};

export const verifyDirtySaveRegression = async (page: Page) => {
  await page.setViewportSize({ width: 960, height: 900 });
  await page.evaluate("window.regression.control.load.replacement='ok';window.regression.swap()");
  await page.getByLabel("Find host or tool", { exact: true }).fill("");
  await page.getByRole("heading", { name: "replacement · Fake host 5", exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Cancel request", exact: true })
    .waitFor({ state: "hidden" });

  await page
    .getByLabel("Interpreter override on host", { exact: true })
    .fill("/fixture/cancelled-save-draft");
  await page.evaluate("window.regression.control.save='hold'");
  await page.getByRole("button", { name: "Save language settings", exact: true }).click();
  await page.getByRole("button", { name: "Cancel request", exact: true }).click();
  assert.equal(
    await page.getByRole("button", { name: "Refresh facts", exact: true }).isEnabled(),
    true
  );
  await noHostAuthority(page);
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel request", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/cancelled-save-draft"
  );
  assert.equal(
    await page.getByRole("button", { name: "Save language settings", exact: true }).isEnabled(),
    true
  );
  await page.evaluate("window.regression.complete('save:replacement')");
  await page.waitForFunction("window.regression.read().revision===1");
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/cancelled-save-draft"
  );
  assert.equal(
    await page
      .getByText(/Saving replaces this scope at revision 0; current observed revision 0/)
      .count(),
    1
  );
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "draft revision 0, current revision 1" })
    .waitFor();
  await noHostAuthority(page);
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/cancelled-save-draft"
  );
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  await page
    .getByLabel("Interpreter override on host", { exact: true })
    .fill("/fixture/new-local-draft");
  await page.evaluate("window.regression.external()");
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page
    .getByRole("alert")
    .filter({ hasText: "draft revision 1, current revision 2" })
    .waitFor();
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/new-local-draft"
  );
  await noHostAuthority(page);
  assert.equal((await snapshot(page)).calls.filter((call) => call.startsWith("save:")).length, 1);
  await page.getByRole("button", { name: "Discard changes", exact: true }).click();
  assert.equal(
    await page.getByLabel("Interpreter override on host", { exact: true }).inputValue(),
    "/fixture/other-writer"
  );
  await page.getByRole("button", { name: "Install", exact: true }).click();
  assert((await snapshot(page)).calls.includes("act:replacement:install"));

  return snapshot(page);
};

export const verifyAuthorityRegression = async (page: Page) => {
  await verifyAdapterAuthorityRegression(page);

  return verifyDirtySaveRegression(page);
};
