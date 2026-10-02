import { expect, test } from "bun:test";
import { join } from "node:path";
import { auditBundle, readBundle } from "./audit";
import { checkCatalog } from "./check";

const root = import.meta.dir;

const bundle = readBundle(join(root, "bundles/typescript-language-server.json"));

test("frozen TS bundle retains full dependency audit and notices", () => {
  expect(auditBundle({ bundle, noticeRoot: join(root, "notices") })).toEqual([]);
});

test("an omitted optional/transitive lock entry cannot masquerade as complete", () => {
  const truncated = { ...bundle, packages: [] };
  const failures = auditBundle({ bundle: truncated, noticeRoot: join(root, "notices") });
  expect(failures.some((failure) => failure.endsWith("closure-size"))).toBe(true);
  expect(failures.some((failure) => failure.includes("closure-integrity"))).toBe(true);
});

test("changing a package root cannot pass a frozen lock audit", () => {
  const packages = bundle.packages.map((pkg) => ({ ...pkg, integrity: "sha512-corrupt" }));
  expect(
    auditBundle({ bundle: { ...bundle, packages }, noticeRoot: join(root, "notices") }).some(
      (failure) => failure.includes("closure-integrity")
    )
  ).toBe(true);
});

test("third party notice disappearance and copyleft metadata are not hidden by root license", () => {
  const packages = bundle.packages.map((pkg) => ({ ...pkg, license: "GPL-3.0-only", notices: [] }));

  const failures = auditBundle({
    bundle: { ...bundle, packages },
    noticeRoot: join(root, "notices"),
  });

  expect(failures.some((failure) => failure.includes("license-review"))).toBe(true);
  expect(failures.some((failure) => failure.includes("notice-coverage"))).toBe(true);
});

test("catalog audit roots and eligibility flags match the exact retained evidence", () => {
  expect(checkCatalog()).toEqual([]);
});
