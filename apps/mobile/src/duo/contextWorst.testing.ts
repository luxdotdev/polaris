/**
 * Worst-case data for the unfolded Duo's context pane (break-ui, ENG-559): a long focused step,
 * a four-digit Turn, a long unbreakable diff line, wordy findings and many long "also" files.
 */
import { RiskFinding } from "@polaris/protocol";
import type { DiffFileInput } from "../review/diffRows.ts";
import { parsePatch } from "../review/patch.ts";
import { finding } from "../review/review.testing.ts";
import type { TurnContext } from "./context.ts";
import type { TurnFiles } from "./contextRows.ts";

export type DevContextData = "worst" | "failed" | "lone";

const FOCUSED =
  "apps/web/src/features/northwind-industries-customer-portal/checkout/useSubscriptionUpgradeEligibilityCalculation.generated.ts";

const LONG_LINE =
  '+const ENDPOINT = "https://billing.internal.northwind-industries-holdings.example.com/v2/customers/cus_Q9yZWFsaXMtZGV2aWNlLWtleS0xMjM0NTY3ODkw/subscriptions?expand[]=items.price.product&expand[]=latest_invoice.payment_intent";';

const PATCH = [
  `diff --git a/${FOCUSED} b/${FOCUSED}`,
  `--- a/${FOCUSED}`,
  `+++ b/${FOCUSED}`,
  "@@ -1284,3 +1284,5 @@ export const useSubscriptionUpgradeEligibilityCalculation = (customer: Customer, plan: Plan) =>",
  ' import { request } from "@northwind/http";',
  "-const ENDPOINT = process.env.BILLING_URL;",
  LONG_LINE,
  "+// Zażółć gęślą jaźń: 結帳流程的升級資格計算 🚧",
  "+const RETRIES = 12_345;",
  " export const eligible = (customer: Customer) =>",
  "",
].join("\n");

const FILES: ReadonlyArray<DiffFileInput> = parsePatch(PATCH).map((diff) => ({
  diff,
  added: 12_345,
  removed: 9_876,
}));

const wordy = (id: string, severity: RiskFinding["severity"], path: string, line: number) => {
  const base = finding(id, severity, { path, line });

  return new RiskFinding({
    id: base.id,
    identity: base.identity,
    source: base.source,
    ruleId: base.ruleId,
    path: base.path,
    lines: base.lines,
    severity,
    confidence: base.confidence,
    suggestion: null,
    status: "open",
    resolution: null,
    title:
      "The billing endpoint is hard-coded to the internal production host, so every preview deployment and every developer machine charges real customers",
    reason:
      "BILLING_URL used to come from the environment; the literal now wins everywhere, including the staging and preview builds that share this module.",
  });
};

const FINDINGS: ReadonlyArray<RiskFinding> = [
  wordy("critical-endpoint", "critical", FOCUSED, 1285),
  finding("medium-retries", "medium", { path: FOCUSED, line: 1287 }),
];

const ALSO_PATHS = [
  "apps/web/src/features/northwind-industries-customer-portal/checkout/SubscriptionUpgradeEligibilityBanner.stories.tsx",
  "packages/design-system/src/components/设计系统组件库/按钮.tsx",
  "a",
  "apps/mobile/node_modules/.bun/@react-native+virtualized-lists@0.88.0+c4fe011fe8ab1ca0/node_modules/@react-native/virtualized-lists/Lists/VirtualizedSectionList.js",
  "README.md",
  ...Array.from(
    { length: 9 },
    (_, index) => `apps/web/src/generated/graphql/fragment-${index + 1}.ts`
  ),
];

const SEVERITIES: ReadonlyArray<RiskFinding["severity"] | null> = [
  "critical",
  "high",
  null,
  "medium",
  "low",
];

const context = (turnNumber: number, also: number): TurnContext => ({
  turnId: "turn-worst",
  turnNumber,
  working: false,
  label: `Edited ${FOCUSED.slice(FOCUSED.lastIndexOf("/") + 1)}`,
  focusKey: "turn-worst:file",
  path: FOCUSED,
  finding: FINDINGS[0] ?? null,
  also: ALSO_PATHS.slice(0, also).map((path, index) => ({
    path,
    severity: SEVERITIES[index % SEVERITIES.length] ?? null,
  })),
});

const FAILED_DIFF =
  "git.diff failed: fatal: bad object 9f8e7d6c5b4a39281706f5e4d3c2b1a098765432 (the Turn's after-checkpoint was garbage-collected on lucas-mac-studio.taild0d828.ts.net)";

export interface DevContext {
  readonly context: TurnContext;
  readonly files: TurnFiles;
  readonly findings: ReadonlyArray<RiskFinding>;
}

export const devContext = (data: DevContextData): DevContext => {
  switch (data) {
    case "worst":
      return {
        context: context(1284, ALSO_PATHS.length),
        files: { kind: "ready", files: FILES, summary: null },
        findings: FINDINGS,
      };
    case "failed":
      return {
        context: context(1, 3),
        files: { kind: "failed", message: FAILED_DIFF, summary: null },
        findings: FINDINGS,
      };
    case "lone":
      return {
        context: context(1, 0),
        files: { kind: "ready", files: [], summary: null },
        findings: [],
      };
  }
};
