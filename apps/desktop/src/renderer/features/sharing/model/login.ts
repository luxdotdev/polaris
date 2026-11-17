/**
 * What a Contributor's Turns run on (DESIGN.md, Shared Sessions; Paper SS3): the owner's Harness
 * login, and a neutral warning when it is a personal subscription or Polaris can't tell. It warns
 * plainly and never refuses: the owner decides.
 */
import { harnessEntry, type HarnessKind, type ShareRole } from "@polaris/protocol";
import type { LimitData } from "../../harness/model/limits.ts";

/** The login a Harness runs on, as its maker names it. */
const LOGIN_NAMES = new Map<string, string>([
  ["claude", "Claude"],
  ["codex", "ChatGPT"],
  ["gemini", "Google"],
  ["copilot", "GitHub Copilot"],
]);

export const loginName = (harness: HarnessKind): string =>
  LOGIN_NAMES.get(harness) ?? harnessEntry(harness)?.name ?? harness;

/** Personal plans as the Harnesses name them in their Plan Limits. */
const CONSUMER = new Set(["free", "go", "plus", "pro", "max", "max-5x", "max-20x", "personal"]);

/** Plans for a company, whose terms are the company's to read: no warning. */
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

/** The login behind `harness` on a Host, from the plan its Plan Limits report; else unknown. */
export const harnessLogin = (
  limits: ReadonlyArray<LimitData>,
  harness: HarnessKind
): HarnessLogin => {
  const plan = limits.find((l) => l.harness === harness && l.plan !== null)?.plan;

  if (plan == null) return { kind: "unknown" };
  const key = plan.trim().toLowerCase();

  if (BUSINESS.has(key)) return { kind: "business" };

  return CONSUMER.has(key) ? { kind: "consumer", plan: planLabel(key) } : { kind: "unknown" };
};

const possessive = (who: string) => (who === "They" ? "Their" : `${who}'s`);

/** The role's plain statement: what the person may do, and on whose login. */
export const roleStatement = (role: ShareRole, who: string, harness: HarnessKind): string =>
  role === "contributor"
    ? `${who} can send Turns and answer approvals. ${possessive(who)} Turns run on your ${loginName(harness)} login and count against your plan.`
    : `${who} can comment on messages and changes, and can't send Turns or answer approvals.`;

/** The warning under a Contributor's statements; null for a commenter or a business login. */
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
