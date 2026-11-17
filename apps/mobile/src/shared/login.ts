/**
 * What a Contributor's Turns run on (DESIGN.md, Shared Sessions; the Desktop App's
 * `sharing/model/login.ts`): the owner's Harness login, and a neutral warning when it is a
 * personal subscription or Polaris can't tell. It warns plainly and never refuses.
 */
import { harnessEntry, type HarnessKind, type PlanLimit, type ShareRole } from "@polaris/protocol";

const LOGIN_NAMES = new Map<string, string>([
  ["claude", "Claude"],
  ["codex", "ChatGPT"],
  ["gemini", "Google"],
  ["copilot", "GitHub Copilot"],
]);

export const loginName = (harness: HarnessKind): string =>
  LOGIN_NAMES.get(harness) ?? harnessEntry(harness)?.name ?? harness;

const CONSUMER = new Set(["free", "go", "plus", "pro", "max", "max-5x", "max-20x", "personal"]);

const BUSINESS = new Set(["team", "business", "enterprise", "edu", "education"]);

export type HarnessLogin =
  | { readonly kind: "consumer"; readonly plan: string }
  | { readonly kind: "business" }
  | { readonly kind: "unknown" };

const planLabel = (plan: string) =>
  plan
    .split(/[-_\s]+/)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");

/** The login behind `harness`, from the plan its Plan Limits report; else unknown. */
export const harnessLogin = (
  limits: ReadonlyArray<Pick<PlanLimit, "harness" | "plan">>,
  harness: HarnessKind
): HarnessLogin => {
  const plan = limits.find((l) => l.harness === harness && l.plan !== null)?.plan;

  if (plan == null) return { kind: "unknown" };
  const key = plan.trim().toLowerCase();

  if (BUSINESS.has(key)) return { kind: "business" };

  return CONSUMER.has(key) ? { kind: "consumer", plan: planLabel(key) } : { kind: "unknown" };
};

/** The warning under a Contributor's lines; null for a Commenter or a company plan. */
export const loginWarning = (
  role: ShareRole,
  login: HarnessLogin,
  harness: HarnessKind
): string | null => {
  if (role !== "contributor" || login.kind === "business") return null;
  const name = loginName(harness);
  const terms = "may not let someone else send Turns on it. A Commenter share avoids this.";

  return login.kind === "consumer"
    ? `This session runs on a personal ${name} login (${login.plan}). Its terms ${terms}`
    : `Polaris can't tell which ${name} login this session runs on. If it's a personal subscription, its terms ${terms}`;
};
