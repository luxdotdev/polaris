import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import type { Page } from "playwright-core";

export const verifyEffectivePreferences = async (page: Page, output: string) => {
  await page.evaluate(`(() => {
    const f = window.integrationFixture;
    const hostId = f.host.status.host.hostId;
    const workspaceId = f.discovery.checkout.workspaceId;
    const records = [
      {scope:{_tag:'App'},revision:0,settings:{}},
      {scope:{_tag:'Language',language:'python'},revision:1,settings:{providers:['language-provider']}},
      {scope:{_tag:'Host',hostId},revision:2,settings:{interpreter:'/host/python',providers:['host-provider']}},
      {scope:{_tag:'Workspace',hostId,workspaceId,language:null},revision:3,settings:{sdk:'/workspace/sdk',formatOnSave:false}},
      {scope:{_tag:'Workspace',hostId,workspaceId,language:'python'},revision:4,settings:{interpreter:'/nested/.venv/python',providers:['workspace-provider-with-a-very-long-name-for-readable-truncation-and-wrap']}},
      {scope:{_tag:'Workspace',hostId,workspaceId:'unrelated',language:'python'},revision:99,settings:{providers:['unrelated-provider']}}
    ];
    for(const record of records) f.records.set(JSON.stringify(record.scope),record);
  })()`);

  await page.getByRole("button", { name: "Refresh facts", exact: true }).click();
  await page
    .getByText(
      "Provider order: workspace-provider-with-a-very-long-name-for-readable-truncation-and-wrap",
      { exact: true }
    )
    .waitFor();
  assert.equal(await page.getByLabel("Settings scope").inputValue(), "app");
  assert.equal(
    await page.getByRole("switch", { name: "Format on save" }).getAttribute("aria-checked"),
    "false"
  );
  assert.equal(await page.getByLabel("Interpreter override on host").inputValue(), "");
  assert.equal(await page.getByText("unrelated-provider", { exact: false }).count(), 0);
  await page.getByLabel("Interpreter override on host").fill("/app/new-python");
  await page.getByRole("button", { name: "Save language settings", exact: true }).click();
  await page.getByText(/current observed revision 1/).waitFor();
  assert.equal(
    await page.getByLabel("Interpreter override on host").inputValue(),
    "/app/new-python"
  );
  await page
    .getByText(
      "Provider order: workspace-provider-with-a-very-long-name-for-readable-truncation-and-wrap",
      { exact: true }
    )
    .waitFor();

  for (const theme of ["dark", "light"]) {
    await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await page
      .getByText(
        "Provider order: workspace-provider-with-a-very-long-name-for-readable-truncation-and-wrap",
        { exact: true }
      )
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, `effective-${theme}.png`) });
  }

  const records = Schema.decodeUnknownSync(Schema.Array(P.LanguageSettingsRecord))(
    await page.evaluate("[...window.integrationFixture.records.values()]")
  );

  const validated = records;
  assert.equal(validated.length, 6);
  assert.deepEqual(
    validated.map((r) => r.revision),
    [1, 1, 2, 3, 4, 99]
  );
  await writeFile(
    join(output, "effective-result.json"),
    JSON.stringify({ records, fakeOnly: true, appOnlySave: true }, null, 2)
  );
};
