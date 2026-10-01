/**
 * Licences of Go modules compiled into a binary Polaris ships (Betterleaks),
 * which `licenses.ts` cannot see through npm. Classification is by the
 * licence text's operative sentences; anything unrecognised is null and fails the check.
 */
import { Schema } from "effect";

export const GoModuleLicense = Schema.Struct({
  path: Schema.String,
  version: Schema.String,
  /** SPDX id, or null when the text was not recognised. */
  license: Schema.NullOr(Schema.String),
  text: Schema.String,
});

export type GoModuleLicense = typeof GoModuleLicense.Type;

export const GoAudit = Schema.Struct({
  betterleaks: Schema.String,
  modules: Schema.Array(GoModuleLicense),
});

export type GoAudit = typeof GoAudit.Type;

const squash = (text: string) => text.replaceAll(/\s+/g, " ").toLowerCase();

const SIGNATURES: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
  ["Apache-2.0", ["apache license", "version 2.0"]],
  ["MPL-2.0", ["mozilla public license", "version 2.0"]],
  ["BSD-3-Clause", ["redistributions in binary form", "neither the name"]],
  [
    "BSD-3-Clause",
    ["redistributions in binary form", "may be used to endorse or promote products"],
  ],
  ["BSD-2-Clause", ["redistributions in binary form must reproduce"]],
  ["ISC", ["permission to use, copy, modify, and/or distribute this software for any purpose"]],
  ["MIT", ["permission is hereby granted, free of charge", "the above copyright notice"]],
];

/** The SPDX id of a licence text, or null if it matches none Polaris recognises. */
export const classifyLicense = (text: string): string | null => {
  const body = squash(text);

  return SIGNATURES.find(([, phrases]) => phrases.every((p) => body.includes(p)))?.[0] ?? null;
};

/** Why `audit` fails the gate: a stale version, or a licence that is unknown or not allowed. */
export const auditProblems = (
  audit: GoAudit,
  pinnedVersion: string,
  isAllowed: (license: string) => boolean
): ReadonlyArray<string> => [
  ...(audit.betterleaks === pinnedVersion
    ? []
    : [
        `the audit covers Betterleaks ${audit.betterleaks} but ${pinnedVersion} is pinned: run \`bun scripts/betterleaks.ts audit\``,
      ]),
  ...audit.modules
    .filter((m) => m.license === null || !isAllowed(m.license))
    .map((m) => `${m.path}@${m.version}: ${m.license ?? "unrecognised licence text"}`),
];

/** The notices section for the Go modules compiled into Betterleaks. */
export const renderGoNotices = (audit: GoAudit): string => {
  const lines = [
    `## Betterleaks ${audit.betterleaks} (shipped beside the Daemon)`,
    "",
    "The `betterleaks` binary is downloaded from its GitHub release, checked against a pinned SHA-256, and placed next to `polaris`. These Go modules are compiled into it (`go version -m`).",
    "",
    "| Module | Version | Licence |",
    "|---|---|---|",
    ...audit.modules.map((m) => `| ${m.path} | ${m.version} | ${m.license ?? "unknown"} |`),
    "",
  ];

  for (const m of audit.modules) {
    lines.push(`### ${m.path}@${m.version}`, "", "```text", m.text.trim(), "```", "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
};
