/**
 * The Rules' part of `polaris selftest`: ast-grep's embedded addon parses
 * with a built-in and a run-time grammar, and Betterleaks beside the binary
 * finds a planted, never-issued token. Returns the line to print.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scanRequest } from "./patterns/child.ts";
import { locateBetterleaks, scanSecrets } from "./secrets/betterleaks.ts";
import { BETTERLEAKS_VERSION } from "./secrets/pin.ts";

const patternsWork = async (dir: string): Promise<string | null> => {
  writeFileSync(join(dir, "a.ts"), "eval(input);\n");
  writeFileSync(join(dir, "a.py"), "eval(expr)\n");

  const reply = await scanRequest({
    root: dir,
    files: [
      { path: "a.ts", language: "tsx" },
      { path: "a.py", language: "python" },
    ],
  });

  const found = reply.matches.map((m) => m.ruleId).sort();

  return found.join() === "js-eval,py-eval" ? null : `ast-grep found [${found.join(", ")}]`;
};

const secretsWork = async (dir: string): Promise<string | null> => {
  const binary = locateBetterleaks();

  if (binary === null) return "betterleaks is missing";
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const token = `${"gh"}p_${Array.from(randomBytes(36), (b) => alphabet[b % 62]).join("")}`;
  writeFileSync(join(dir, "token.ts"), `export const token = "${token}";\n`);
  const scan = await scanSecrets(binary, dir, { kind: "files" }, AbortSignal.timeout(30_000));

  if (scan.version !== BETTERLEAKS_VERSION) return `betterleaks is ${scan.version}`;

  return scan.hits.some((hit) => hit.ruleId === "github-pat") ? null : "betterleaks found nothing";
};

export const rulesSelfTest = async (scratch: string): Promise<{ ok: boolean; line: string }> => {
  const patterns = join(scratch, "rules-patterns");
  const secrets = join(scratch, "rules-secrets");
  mkdirSync(patterns, { recursive: true });
  mkdirSync(secrets, { recursive: true });

  const problems = (
    await Promise.all([
      patternsWork(patterns).catch((error: Error) => `ast-grep: ${error.message}`),
      secretsWork(secrets).catch((error: Error) => `betterleaks: ${error.message}`),
    ])
  ).filter((problem) => problem !== null);

  return problems.length === 0
    ? { ok: true, line: `rules: ok (ast-grep, betterleaks ${BETTERLEAKS_VERSION})` }
    : { ok: false, line: `rules: ${problems.join("; ")}` };
};
