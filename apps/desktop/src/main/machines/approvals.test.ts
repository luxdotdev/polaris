import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openApprovals } from "./approvals.ts";

const approval = (sha256: string) => ({
  sha256,
  platform: "linux-arm64",
  version: "0.2.0",
  approvedAt: 1,
});

test("approvals persist per alias and survive a reopen", () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-approvals-"));
  const path = join(dir, "approvals.json");

  try {
    const approvals = openApprovals(path);
    expect(approvals.approved("studio").size).toBe(0);
    approvals.approve("studio", approval("aaa"));
    approvals.approve("studio", approval("aaa"));
    approvals.approve("pi", approval("bbb"));

    const reopened = openApprovals(path);
    expect([...reopened.approved("studio")]).toEqual(["aaa"]);
    expect([...reopened.approved("pi")]).toEqual(["bbb"]);

    reopened.forget("studio");
    expect(openApprovals(path).approved("studio").size).toBe(0);
    expect(openApprovals(path).approved("pi").size).toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an unreadable file means no approvals", () => {
  const dir = mkdtempSync(join(tmpdir(), "polaris-approvals-"));
  const path = join(dir, "approvals.json");

  try {
    writeFileSync(path, "{not json");
    expect(openApprovals(path).approved("studio").size).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
