import { verifyConfirmedPolicy } from "./policy.regression.testing.ts";
import * as P from "@polaris/protocol";
import { Schema } from "effect";
import { strict as assert } from "node:assert";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";

export const verifyLiveFeed = async (page: Page, output: string) => {
  await verifyConfirmedPolicy(page, output);

  const expected = Schema.decodeUnknownSync(P.LanguageAvailability)(
    await page.evaluate("window.integrationFixture.control.availability")
  );

  const installationRow = `Installing 1 · pinned ${expected.pinnedVersion}`;
  await page.evaluate(`(() => {
    const c=window.integrationFixture.control;
    c.availability={...c.availability, checkedAt:c.availability.checkedAt+1,
      installation:{_tag:'Installing',jobId:'render-job',version:'1'}};
    c.feeds.filter(f=>!f.stopped&&f.kind==='languages.availability.watch').forEach(f=>f.emit([[c.availability]]));
  })()`);
  await page.getByText(installationRow, { exact: true }).waitFor();
  await page.getByLabel("Interpreter override on host").fill("/draft/unchanged");
  await page.evaluate(`(() => {
    const c=window.integrationFixture.control;
    const a=c.availability;
    window.feedProgress={hostId:a.hostId,toolId:a.toolId,jobId:'render-job',version:'1',sequence:2,
      phase:'downloading',downloadedBytes:20,totalBytes:100,message:'Owned live feed',activeVersion:null};
    c.feeds.filter(f=>!f.stopped&&f.kind==='languages.install.watch').forEach(f=>f.emit([window.feedProgress]));
  })()`);
  await page
    .getByText("Observed downloading · 20 / 100 bytes · Owned live feed", { exact: true })
    .waitFor();
  await page.evaluate(`window.integrationFixture.control.feeds.filter(f=>!f.stopped&&f.kind==='languages.install.watch').forEach(f=>f.emit([
    {...window.feedProgress,sequence:300,jobId:'foreign-job',message:'Foreign job progress'},
    {...window.feedProgress,sequence:301,hostId:'foreign-host',message:'Foreign host progress'},
    {...window.feedProgress,sequence:302,version:'foreign-version',message:'Foreign version progress'},
    {...window.feedProgress,sequence:1,message:'Stale sequence progress'}
  ]))`);
  assert.equal(
    await page.getByText(/Foreign (job|host|version) progress|Stale sequence progress/).count(),
    0
  );
  assert.equal(
    await page
      .getByText("Observed downloading · 20 / 100 bytes · Owned live feed", { exact: true })
      .count(),
    1
  );
  assert.equal(
    await page.getByLabel("Interpreter override on host").inputValue(),
    "/draft/unchanged"
  );
  assert.equal(await page.getByRole("button", { name: "Install", exact: true }).count(), 0);

  for (const theme of ["dark", "light"]) {
    await page.evaluate(`document.documentElement.dataset.theme=${JSON.stringify(theme)}`);
    await page.screenshot({ path: join(output, `feed-${theme}.png`) });
  }

  await page.evaluate(`window.integrationFixture.disconnect()`);
  await page.getByText("Offline · Current host facts", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Reconnect host", exact: true }).waitFor();
  await page.evaluate(
    `window.integrationFixture.control.feeds.filter(f=>f.stopped&&f.kind==='languages.install.watch').forEach(f=>f.emit([{...window.feedProgress,sequence:999,message:'Late obsolete progress'}]))`
  );
  assert.equal(await page.getByText(/Late obsolete progress/).count(), 0);
  assert.equal(
    await page.getByLabel("Interpreter override on host").inputValue(),
    "/draft/unchanged"
  );
  await page.evaluate(`window.integrationFixture.reconnect()`);
  await page.getByText(installationRow, { exact: true }).waitFor();
  await page.evaluate(
    `window.integrationFixture.control.feeds.filter(f=>!f.stopped&&f.kind==='languages.install.watch').forEach(f=>f.emit([{...window.feedProgress,sequence:3,phase:'verifying',message:'Fresh reconnect progress'}]))`
  );
  await page.getByText(/Observed verifying.*Fresh reconnect progress/).waitFor();
  assert.equal(
    await page.getByLabel("Interpreter override on host").inputValue(),
    "/draft/unchanged"
  );

  const facts = await page.evaluate(
    `({feeds:window.integrationFixture.control.feeds.map(f=>({kind:f.kind,stopped:f.stopped})),records:[...window.integrationFixture.records.values()]})`
  );

  await writeFile(
    join(output, "feed-result.json"),
    JSON.stringify(
      { fakeOnly: true, dirtyDraftPreserved: true, lateOldIgnored: true, facts },
      null,
      2
    )
  );
};
