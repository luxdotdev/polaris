import { Schema } from "effect";
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";

export const verifyConfirmedPolicy = async (page: Page, output: string) => {
  const external = page.getByLabel("External images", { exact: true });
  await external.selectOption("allow");
  await page.waitForFunction("window.integrationFixture.refreshes.length===1");
  await external.selectOption("deny");
  await page.waitForFunction("window.integrationFixture.refreshes.length===2");

  const confirmed = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Number))(
    await page.evaluate("window.integrationFixture.previewEpochs()")
  );

  assert.equal(Object.values(confirmed).filter((value) => value === 2).length, 1);
  assert.equal(Object.values(confirmed).filter((value) => value === 7).length, 1);
  assert.equal(Object.values(confirmed).filter((value) => value === 11).length, 1);
  await page.evaluate("window.integrationFixture.control.fail=true");
  await external.selectOption("allow");
  await page
    .getByText("Couldn't save preview policy. Refresh to retry.", { exact: true })
    .waitFor();
  await page.evaluate("window.integrationFixture.control.fail=false");
  await page.getByRole("button", { name: "Refresh preview policy", exact: true }).click();
  await external.selectOption("allow");
  await page.getByText("Preview policy saved.", { exact: true }).waitFor();
  await page.waitForFunction("window.integrationFixture.refreshes.length===3");

  const baseline = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Number))(
    await page.evaluate("window.integrationFixture.previewEpochs()")
  );

  await page.evaluate("window.integrationFixture.control.foreignPolicy=true");
  await external.selectOption("deny");
  await page
    .getByText("Policy confirmation did not match. Refresh to check its outcome.", { exact: true })
    .waitFor();
  await page.evaluate("window.integrationFixture.control.foreignPolicy=false");
  await page.getByRole("button", { name: "Refresh preview policy", exact: true }).click();
  await page.waitForFunction(() => {
    const label = [...document.querySelectorAll("label")].find(
      (el) => el.textContent === "External images"
    );

    const id = label?.getAttribute("for");

    return (
      id !== null &&
      id !== undefined &&
      document.getElementById(id)?.hasAttribute("disabled") === false
    );
  });
  await page.evaluate(
    "window.integrationFixture.control.holdPolicyOnly=true;window.integrationFixture.control.hold=true"
  );

  const completedBefore = Schema.decodeUnknownSync(Schema.Number)(
    await page.evaluate("window.integrationFixture.control.policyCompletions")
  );

  try {
    await external.selectOption("allow");
    await page.waitForFunction("window.integrationFixture.control.policyPending===true");
    await page.evaluate("window.integrationFixture.disconnect()");
    await page.getByText("Offline · Current host facts", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Reconnect host", exact: true }).waitFor();
    assert.equal(await page.evaluate("window.integrationFixture.control.policyPending"), true);
    assert.equal(
      await page.evaluate("window.integrationFixture.control.policyCompletions"),
      completedBefore
    );
    await page.evaluate("window.integrationFixture.control.releasePolicy()");
    await page.waitForFunction(
      `window.integrationFixture.control.policyCompletions===${completedBefore + 1}`
    );
    assert.deepEqual(await page.evaluate("window.integrationFixture.previewEpochs()"), baseline);
  } finally {
    await page.evaluate(
      "window.integrationFixture.control.hold=false;window.integrationFixture.control.holdPolicyOnly=false;window.integrationFixture.control.releasePolicy()"
    );
  }

  await page.evaluate("window.integrationFixture.reconnect()");
  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page.getByText("This worktree inherits its workspace's trust.", { exact: false }).waitFor();

  const final = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Number))(
    await page.evaluate("window.integrationFixture.previewEpochs()")
  );

  assert.deepEqual(final, baseline);
  assert.equal(await page.evaluate("window.integrationFixture.refreshes.length"), 3);
  await writeFile(
    join(output, "policy-result.json"),
    JSON.stringify(
      { confirmed, baseline, final, grantRevoke: true, failedWrongCancelledNoRefresh: true },
      null,
      2
    )
  );
};
