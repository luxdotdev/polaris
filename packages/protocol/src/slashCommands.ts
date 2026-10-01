/**
 * Skills and Slash Commands (CONTEXT.md): what a Harness offers by name in a
 * Workspace, and how Polaris runs each. Listed by `harness.commands`; the
 * composer's `/` menu shows them and a chosen one rides in the Turn's text.
 */
import { Schema } from "effect";
import { Timestamp } from "./domain.ts";
import { HarnessKind } from "./harnesses.ts";

/** A Skill (a `SKILL.md` folder) or any other Slash Command. */
export const SlashCommandKind = Schema.Literals(["skill", "command"]);

export type SlashCommandKind = typeof SlashCommandKind.Type;

/** Where it comes from: the Harness itself, the user's own, the Workspace's, or a plugin's. */
export const SlashCommandSource = Schema.Literals(["built-in", "user", "project", "plugin"]);

export type SlashCommandSource = typeof SlashCommandSource.Type;

/**
 * How it runs. `text`: the Turn carries it as text and the Harness reads it.
 * `harness`: the Turn carries it too, and the driver turns it into the
 * Harness's own call (Codex `/compact` → `thread/compact/start`). `polaris`:
 * the Client does `action` itself and sends nothing. Commands only a
 * Harness's terminal UI can run are never listed.
 */
export const SlashCommandRun = Schema.Literals(["text", "harness", "polaris"]);

export type SlashCommandRun = typeof SlashCommandRun.Type;

/** What a `polaris` command does in the Client. */
export const PolarisAction = Schema.Literals([
  /** Start a new Agent Session in the same place (`/clear`, `/new`). */
  "new-session",
  /** Open the Model and effort menu (`/model`, `/effort`). */
  "model",
  /** Show the Turn's diff in Output (`/diff`). */
  "diff",
  /** Open Settings → Usage (`/usage`, `/cost`). */
  "usage",
]);

export type PolarisAction = typeof PolarisAction.Type;

export class SlashCommand extends Schema.Class<SlashCommand>("SlashCommand")({
  /** As typed after the sigil: `compact`, `review`, `codex:rescue`. */
  name: Schema.String,
  /** What invokes it in text: `/` for most, `$` for a Codex Skill. */
  sigil: Schema.Literals(["/", "$"]),
  description: Schema.String,
  /** What it takes after its name (`<optional instructions>`), when it says. */
  argumentHint: Schema.NullOr(Schema.String),
  kind: SlashCommandKind,
  source: SlashCommandSource,
  /** The plugin it comes from, for `source: "plugin"`. */
  plugin: Schema.NullOr(Schema.String),
  run: SlashCommandRun,
  /** For `run: "polaris"`. */
  action: Schema.NullOr(PolarisAction),
  /**
   * The text the Turn sends instead of the command, with `$ARGUMENTS` standing
   * for what follows it: a Codex custom prompt, which only Codex's TUI expands.
   */
  template: Schema.NullOr(Schema.String),
}) {}

export class HarnessCommands extends Schema.Class<HarnessCommands>("HarnessCommands")({
  harness: HarnessKind,
  cwd: Schema.String,
  /** Skills first, then the rest, each by name. */
  commands: Schema.Array(SlashCommand),
  /** When the Daemon last read them; cached per Harness and directory. */
  fetchedAt: Timestamp,
}) {}
