/**
 * Codex's Skills and Slash Commands in a directory: its Skills from
 * `skills/list` (asked like `model/list`, see `models.ts`), the user's custom
 * prompts from `$CODEX_HOME/prompts`, and the few built-in commands Polaris can
 * run. The README has the table.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { SlashCommand, type SlashCommandSource } from "@polaris/protocol";
import { Effect, Option, Schema } from "effect";
import type { HarnessError } from "../HarnessDriver.ts";
import { askAppServer, type ListingConfig } from "./models.ts";
import * as P from "./protocol.ts";
import { codexError, type RpcConnection } from "./RpcConnection.ts";

type Fields = Omit<ConstructorParameters<typeof SlashCommand>[0], "name" | "description">;

const BUILTIN: Fields = {
  sigil: "/",
  argumentHint: null,
  kind: "command",
  source: "built-in",
  plugin: null,
  run: "harness",
  action: null,
  template: null,
};

/** Codex's own commands Polaris runs; the rest of its TUI's commands aren't offered. */
export const CODEX_BUILTINS: ReadonlyArray<SlashCommand> = [
  new SlashCommand({
    ...BUILTIN,
    name: "compact",
    description: "Summarize the conversation to free up context",
  }),
  new SlashCommand({
    ...BUILTIN,
    name: "review",
    description: "Review the uncommitted changes, or what you ask for",
    argumentHint: "<optional instructions>",
  }),
  new SlashCommand({
    ...BUILTIN,
    name: "model",
    description: "Choose the Model and reasoning effort",
    run: "polaris",
    action: "model",
  }),
  new SlashCommand({
    ...BUILTIN,
    name: "new",
    description: "Start a new session here",
    run: "polaris",
    action: "new-session",
  }),
  new SlashCommand({
    ...BUILTIN,
    name: "diff",
    description: "Show the Turn's changes",
    run: "polaris",
    action: "diff",
  }),
];

type CodexSkill = (typeof P.SkillsListResponse.Type)["data"][number]["skills"][number];

const SCOPES: Readonly<Record<CodexSkill["scope"], SlashCommandSource>> = {
  user: "user",
  repo: "project",
  system: "built-in",
  admin: "built-in",
};

export const toSkill = (skill: CodexSkill): SlashCommand =>
  new SlashCommand({
    name: skill.name,
    sigil: "$",
    description: skill.shortDescription ?? skill.description,
    argumentHint: null,
    kind: "skill",
    source: skill.pluginId === null ? SCOPES[skill.scope] : "plugin",
    plugin: skill.pluginId,
    run: "text",
    action: null,
    template: null,
  });

const decodeSkills = Schema.decodeUnknownOption(P.SkillsListResponse);

const listSkills = (conn: RpcConnection, cwd: string) =>
  Effect.gen(function* () {
    const params: P.ClientParams["skills/list"] = { cwds: [cwd] };
    const reply = decodeSkills(yield* conn.request("skills/list", params));

    if (Option.isNone(reply))
      return yield* codexError("Unexpected skills/list response from Codex");

    return reply.value.data
      .flatMap((entry) => entry.skills)
      .filter((skill) => skill.enabled)
      .map(toSkill);
  });

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/** A frontmatter field's value, unquoted; null when absent. */
const field = (frontmatter: string, name: string): string | null => {
  const line = frontmatter
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${name}:`))
    ?.slice(name.length + 1)
    .trim();

  return line === undefined || line === "" ? null : line.replace(/^(["'])(.*)\1$/, "$2");
};

/** A custom prompt file, which only Codex's TUI expands: Polaris sends its body. */
export const toPrompt = (file: string, text: string): SlashCommand => {
  const match = FRONTMATTER.exec(text);
  const frontmatter = match?.[1] ?? "";
  const body = match === null ? text : text.slice(match[0].length);
  const firstLine = body.trim().split(/\r?\n/)[0] ?? "";

  return new SlashCommand({
    name: `prompts:${basename(file, ".md")}`,
    sigil: "/",
    description: field(frontmatter, "description") ?? firstLine,
    argumentHint: field(frontmatter, "argument-hint"),
    kind: "command",
    source: "user",
    plugin: null,
    run: "text",
    action: null,
    template: body.trim(),
  });
};

export const readPrompts = (codexHome: string): ReadonlyArray<SlashCommand> => {
  const dir = join(codexHome, "prompts");

  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((name) => name.endsWith(".md"))
    .map((name) => toPrompt(name, readFileSync(join(dir, name), "utf8")));
};

const codexHome = () => process.env.CODEX_HOME ?? join(homedir(), ".codex");

const byName = (a: SlashCommand, b: SlashCommand) => a.name.localeCompare(b.name);

export const listCodexCommands =
  (config: ListingConfig) =>
  (cwd: string): Effect.Effect<ReadonlyArray<SlashCommand>, HarnessError> =>
    Effect.gen(function* () {
      const skills = yield* askAppServer(config, "Skills", (conn) => listSkills(conn, cwd));
      const prompts = yield* Effect.sync(() => readPrompts(codexHome()));

      return [...[...skills].sort(byName), ...[...prompts, ...CODEX_BUILTINS].sort(byName)];
    });
