/**
 * The user's one-time install approvals, per Host alias and build SHA-256, in
 * `<userData>/approvals.json`. An approval covers exactly one build on one
 * Host; upgrades after it need none. Written whole and atomically.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Option, Schema } from "effect";

export const Approval = Schema.Struct({
  sha256: Schema.String,
  platform: Schema.String,
  version: Schema.String,
  /** ms since epoch. */
  approvedAt: Schema.Number,
});

export type Approval = typeof Approval.Type;

const ApprovalsFile = Schema.Record(Schema.String, Schema.Array(Approval));

type ApprovalsFile = typeof ApprovalsFile.Type;

const decode = Schema.decodeUnknownOption(Schema.fromJsonString(ApprovalsFile));

export interface Approvals {
  /** The SHA-256 values approved for `alias`. */
  readonly approved: (alias: string) => ReadonlySet<string>;
  readonly approve: (alias: string, approval: Approval) => void;
  /** Forgets every approval for a removed Host. */
  readonly forget: (alias: string) => void;
}

export const approvalsPath = (userData: string) => join(userData, "approvals.json");

export const openApprovals = (path: string): Approvals => {
  let byAlias: ApprovalsFile = existsSync(path)
    ? Option.getOrElse(decode(readFileSync(path, "utf8")), () => ({}))
    : {};

  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.part`, `${JSON.stringify(byAlias, null, 2)}\n`);
    renameSync(`${path}.part`, path);
  };

  return {
    approved: (alias) => new Set((byAlias[alias] ?? []).map((a) => a.sha256)),
    approve: (alias, approval) => {
      const kept = (byAlias[alias] ?? []).filter((a) => a.sha256 !== approval.sha256);
      byAlias = { ...byAlias, [alias]: [...kept, approval] };
      save();
    },
    forget: (alias) => {
      if (!Object.hasOwn(byAlias, alias)) return;
      const { [alias]: _gone, ...rest } = byAlias;
      byAlias = rest;
      save();
    },
  };
};
