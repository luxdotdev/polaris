// oxlint JS plugin: the security invariants, each with an allowlist (`allowlist.mjs`).
// See packages/lint-config/README.md and docs/security/README.md.
import { fileURLToPath } from "node:url";
import { relative, sep } from "node:path";
import {
  GIT_CONFIG_MODE,
  GIT_SPAWN,
  IMAGE_DECODE,
  REPOSITORY_ENV,
  SPAWN_PATH,
} from "./allowlist.mjs";

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

/** Options replace `allowlist.mjs`'s scope and allowlist; only the fixtures pass them. */
const OPTIONS = [
  {
    type: "object",
    properties: {
      scope: { type: "array", items: { type: "string" } },
      allow: { type: "object", additionalProperties: { type: "string" } },
      builders: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
];

/** Tests, test helpers, fixtures and benches set up their own repositories and images. */
const EXEMPT = [
  /\.(test|testing|fixture|bench)\.[cm]?[jt]sx?$/,
  /(^|\/)testing(\.[cm]?[jt]sx?$|\/)/,
];

const repoPath = (filename) => relative(ROOT, filename).split(sep).join("/");

/** The rule's scope and allowlist: its options (the fixtures pass their own), else `allowlist.mjs`. */
const settings = (context, defaults) => ({ ...defaults, ...context.options[0] });

/** Whether the rule checks this file, and the allowlist entry it has, if any. */
const placement = (context, defaults) => {
  const config = settings(context, defaults);
  const path = repoPath(context.filename);
  const checked = config.scope.some((prefix) => path.startsWith(prefix));

  return {
    config,
    checked: checked && !EXEMPT.some((pattern) => pattern.test(path)),
    entry: config.allow[path] ?? null,
  };
};

const SPAWNERS = new Set(["spawn", "spawnSync", "execFile", "execFileSync"]);

/** `exec` only as an imported function: `regex.exec(…)` is no spawn. */
const SHELL_SPAWNERS = new Set(["exec", "execSync"]);

/** The spawning function a call names, or null. */
const spawner = (call) => {
  const name = calleeName(call.callee);

  if (SPAWNERS.has(name)) return name;

  return call.callee.type === "Identifier" && SHELL_SPAWNERS.has(name) ? name : null;
};

/** The called function's own name: `spawn` for `Bun.spawn(…)`, `spawn(…)` and `cp.spawn(…)`. */
const calleeName = (callee) => {
  if (callee.type === "Identifier") return callee.name;

  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier"
  )
    return callee.property.name;

  return null;
};

const QUOTED = /^["']/;

const stringOf = (node) => {
  if (node?.type === "Literal" && QUOTED.test(node.raw ?? "")) return String(node.value);

  if (node?.type === "TemplateLiteral") return node.quasis[0]?.value.cooked ?? null;

  return null;
};

const GIT_COMMAND = /^(?:\S*\/)?git(?:\s|$)/;

const isWhichGit = (node) =>
  node?.type === "CallExpression" &&
  calleeName(node.callee) === "which" &&
  stringOf(node.arguments[0]) === "git";

/** `gitExecutable(…)`: git's absolute path, which a spawn outside git.ts must not start either. */
const isGitExecutable = (node) =>
  node?.type === "CallExpression" && calleeName(node.callee) === "gitExecutable";

/** Whether an expression names git: `"git"`, `"/usr/bin/git status"`, `which("git")`, `gitExecutable()`, a const of one. */
const namesGit = (node, consts) => {
  if (node === undefined || node === null) return false;

  const text = stringOf(node);

  if (text !== null) return GIT_COMMAND.test(text);

  switch (node.type) {
    case "Identifier":
      return consts.has(node.name);
    case "LogicalExpression":
      return namesGit(node.left, consts) || namesGit(node.right, consts);
    case "ConditionalExpression":
      return namesGit(node.consequent, consts) || namesGit(node.alternate, consts);
    case "AwaitExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
      return namesGit(node.expression ?? node.argument, consts);
    default:
      return isWhichGit(node) || isGitExecutable(node);
  }
};

/** Whether a spawn's first argument runs git: a command string, an argv array, or `{ cmd }`. */
const runsGit = (argument, consts) => {
  if (argument?.type === "ArrayExpression") return namesGit(argument.elements[0], consts);

  if (argument?.type === "ObjectExpression") {
    const cmd = argument.properties.find((p) => p.type === "Property" && keyName(p) === "cmd");

    return cmd?.value.type === "ArrayExpression" && namesGit(cmd.value.elements[0], consts);
  }

  return namesGit(argument, consts);
};

/** An argv (or `{ cmd }`) that starts a bare `git`, which Windows looks up in the cwd first. */
const bareGit = (argument) => {
  const argv =
    argument?.type === "ObjectExpression"
      ? argument.properties.find((p) => p.type === "Property" && keyName(p) === "cmd")?.value
      : argument;

  return argv?.type === "ArrayExpression" && stringOf(argv.elements[0]) === "git";
};

const keyName = (property) => {
  if (property.key.type === "Identifier") return property.key.name;

  return stringOf(property.key);
};

const GIT_SPAWN_MESSAGE =
  "The Daemon runs git through apps/daemon/src/git/git.ts (runGit, gitText, git): the safe config " +
  "and bounded output. A new direct spawn needs an entry in plugins/security/allowlist.mjs.";

const SAFE_PATH_MESSAGE =
  "This file is allowlisted to run git on the safe path, so its git must get safeConfigEnv's " +
  "settings; it no longer calls safeConfigEnv.";

const BARE_GIT_MESSAGE =
  "Start git as gitExecutable(), its absolute path: on Windows a bare `git` runs a git.exe in " +
  "the cwd, the repository, before PATH (docs/adr/0069-git-runs-by-its-absolute-path.md).";

const gitSpawn = {
  meta: {
    type: "problem",
    schema: OPTIONS,
    docs: { description: "Git is started only through git.ts, or an allowlisted safe-path user." },
  },
  create(context) {
    const { checked, entry } = placement(context, GIT_SPAWN);

    if (!checked) return {};

    const consts = new Set();
    const candidates = [];
    let callsSafeConfig = false;

    return {
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && namesGit(node.init, consts)) consts.add(node.id.name);
      },
      CallExpression(node) {
        const name = calleeName(node.callee);

        if (name === "safeConfigEnv") callsSafeConfig = true;

        if (isWhichGit(node) || (spawner(node) !== null && node.arguments.length > 0))
          candidates.push(node);
      },
      TaggedTemplateExpression(node) {
        if (node.tag.type === "Identifier" && node.tag.name === "$") candidates.push(node);
      },
      "Program:exit"(program) {
        if (entry === "safe" && !callsSafeConfig)
          context.report({ node: program, message: SAFE_PATH_MESSAGE });

        if (entry !== null) {
          for (const node of candidates)
            if (
              node.type === "CallExpression" &&
              spawner(node) !== null &&
              bareGit(node.arguments[0])
            )
              context.report({ node, message: BARE_GIT_MESSAGE });

          return;
        }

        for (const node of candidates) {
          const git =
            node.type === "TaggedTemplateExpression"
              ? GIT_COMMAND.test(node.quasi.quasis[0]?.value.cooked.trim() ?? "")
              : isWhichGit(node) || runsGit(node.arguments[0], consts);

          if (git) context.report({ node, message: GIT_SPAWN_MESSAGE });
        }
      },
    };
  },
};

/** Calls that return an absolute program (`platform/executable.ts`), or a whole argv starting with one. */
const RESOLVERS = new Set(["executableOf", "gitExecutable", "launchArgv"]);

const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/])/;

const unwrap = (node) =>
  node?.type === "TSAsExpression" || node?.type === "TSNonNullExpression"
    ? unwrap(node.expression)
    : node;

const isResolverCall = (node) =>
  node?.type === "CallExpression" && RESOLVERS.has(calleeName(node.callee));

const isExecPath = (node) =>
  node?.type === "MemberExpression" &&
  node.object.type === "Identifier" &&
  node.object.name === "process" &&
  calleeName(node) === "execPath";

/** How a spawn names its program and options: Bun's argv (or `{ cmd }`), or node's `file, args`. */
const spawnParts = (call) => {
  const [first, second, third] = call.arguments;

  if (first?.type === "ArrayExpression")
    return { argv: first, program: unwrap(first.elements[0]), options: second ?? null };

  if (first?.type === "ObjectExpression") {
    const cmd = first.properties.find((p) => p.type === "Property" && keyName(p) === "cmd");

    return {
      argv: cmd?.value ?? null,
      program: cmd?.value.type === "ArrayExpression" ? unwrap(cmd.value.elements[0]) : null,
      options: first,
    };
  }

  // `Bun.spawn(argv, options)` with an argv built elsewhere: its program is unknown here.
  if (call.callee.type === "MemberExpression" && calleeName(call.callee.object) === "Bun")
    return { argv: first, program: null, options: second ?? null };

  const options = [second, third].find((a) => a?.type === "ObjectExpression") ?? null;

  return { argv: null, program: unwrap(first), options };
};

/** Whether the spawn may start in a cwd it names: a `cwd` option, or options it can't see into. */
const mayHaveCwd = (options) => {
  if (options === null || options === undefined) return false;

  if (options.type !== "ObjectExpression") return options.type === "Identifier";

  return options.properties.some(
    (p) => p.type === "SpreadElement" || (p.type === "Property" && keyName(p) === "cwd")
  );
};

/** A program's text: a literal, or a const holding one. */
const programText = (program, consts) =>
  program?.type === "Identifier" ? (consts.get(program.name) ?? null) : stringOf(program);

/** A program the spawn starts by its absolute path: a resolver's, an absolute literal, Bun's own. */
const resolvedProgram = (parts, consts) => {
  if (isResolverCall(unwrap(parts.argv))) return true;

  const text = programText(parts.program, consts);

  if (text !== null) return ABSOLUTE.test(text);

  return isResolverCall(parts.program) || isExecPath(parts.program);
};

/** A literal program with no directory: `"ssh"`, `"git"`, `"powershell.exe"`. */
const bareLiteral = (parts, consts) => {
  const text = programText(parts.program, consts);

  return text !== null && !/[\\/]/.test(text);
};

const isBunWhich = (node) =>
  node.callee.type === "MemberExpression" &&
  calleeName(node.callee) === "which" &&
  calleeName(node.callee.object) === "Bun";

const BARE_PROGRAM_MESSAGE =
  "Start this program by its absolute path, executableOf(name): on Windows a bare name runs a " +
  "program in the cwd before PATH (docs/adr/0070-programs-run-by-their-absolute-path.md).";

const CWD_PROGRAM_MESSAGE =
  "This spawn starts in a cwd (a repository, maybe) with a program this rule can't see is " +
  "absolute: pass executableOf(program), or add the file to allowlist.mjs saying where it is resolved.";

const WHICH_MESSAGE =
  "Find programs with findExecutable/executableOf (platform/executable.ts): Bun.which returns a " +
  "relative path for a `.` PATH entry, which a spawn then resolves against its own cwd.";

const spawnPath = {
  meta: {
    type: "problem",
    schema: OPTIONS,
    docs: { description: "The Daemon starts programs by their absolute path, never a bare name." },
  },
  create(context) {
    const { checked, entry } = placement(context, SPAWN_PATH);

    if (!checked) return {};

    const consts = new Map();
    const spawns = [];

    return {
      VariableDeclarator(node) {
        const text = stringOf(node.init);

        if (node.id.type === "Identifier" && text !== null) consts.set(node.id.name, text);
      },
      CallExpression(node) {
        if (isBunWhich(node) && entry !== "resolver")
          context.report({ node, message: WHICH_MESSAGE });

        if (spawner(node) !== null && node.arguments.length > 0) spawns.push(node);
      },
      "Program:exit"() {
        for (const node of spawns) {
          const parts = spawnParts(node);

          if (bareLiteral(parts, consts)) context.report({ node, message: BARE_PROGRAM_MESSAGE });
          else if (entry === null && mayHaveCwd(parts.options) && !resolvedProgram(parts, consts))
            context.report({ node, message: CWD_PROGRAM_MESSAGE });
        }
      },
    };
  },
};

const HOST_MODES = new Set(["host", "trusted-fetch"]);

/** Whether an expression can evaluate to a literal `"host"` or `"trusted-fetch"`. */
const hostMode = (node) => {
  const text = stringOf(node);

  if (text !== null) return HOST_MODES.has(text);

  switch (node?.type) {
    case "ConditionalExpression":
      return hostMode(node.consequent) || hostMode(node.alternate);
    case "LogicalExpression":
      return hostMode(node.left) || hostMode(node.right);
    case "TSAsExpression":
    case "TSSatisfiesExpression":
      return hostMode(node.expression);
    default:
      return false;
  }
};

const gitConfigMode = {
  meta: {
    type: "problem",
    schema: OPTIONS,
    docs: { description: 'Only allowlisted git the user asked for passes `config: "host"`.' },
  },
  create(context) {
    const { checked, entry } = placement(context, GIT_CONFIG_MODE);

    if (!checked || entry !== null) return {};

    return {
      Property(node) {
        if (keyName(node) === "config" && hostMode(node.value))
          context.report({
            node,
            message:
              'config: "host" / "trusted-fetch" runs the repository\'s own commands (ADR 0056). ' +
              "Only git the user asked for passes it; add the call site to allowlist.mjs with why.",
          });
      },
    };
  },
};

const MERMAID = /^(?:mermaid(?:\/.*)?|@streamdown\/mermaid)$/;

const IMAGE_MESSAGE =
  "Host or Workspace image bytes reach a decoder only after admitRaster " +
  "(renderer/features/host-images, main/languages/media.ts). Use readHostImage, or add this " +
  "file to allowlist.mjs saying where its bytes come from.";

const MERMAID_MESSAGE =
  "Mermaid renders only through guardedDiagrams (session/ui/markdown/diagrams.ts), via usePlugins.";

const isTypeOnly = (node) =>
  node.importKind === "type" ||
  (node.specifiers.length > 0 && node.specifiers.every((s) => s.importKind === "type"));

const isUrlCreate = (callee) =>
  callee.type === "MemberExpression" &&
  callee.object.type === "Identifier" &&
  callee.object.name === "URL" &&
  calleeName(callee) === "createObjectURL";

/** Why a call hands bytes to a decoder, or null. */
const decodeCall = (node) => {
  const name = calleeName(node.callee);

  if (name === "createImageBitmap") return "createImageBitmap";

  if (isUrlCreate(node.callee)) return "URL.createObjectURL";

  if (name === "decode" && node.callee.type === "MemberExpression" && node.arguments.length === 0)
    return "an image's decode()";

  if (name === "createElement" && stringOf(node.arguments[0])?.toLowerCase() === "img")
    return 'createElement("img")';

  return null;
};

const imageDecode = {
  meta: {
    type: "problem",
    schema: OPTIONS,
    docs: {
      description: "Image bytes reach a decoder only through admitRaster; Mermaid only guarded.",
    },
  },
  create(context) {
    const { checked, entry } = placement(context, IMAGE_DECODE);

    if (!checked || entry !== null) return {};

    const report = (node, what) => context.report({ node, message: `${what}: ${IMAGE_MESSAGE}` });

    return {
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          ["Image", "ImageDecoder"].includes(node.callee.name)
        )
          report(node, `new ${node.callee.name}()`);
      },
      CallExpression(node) {
        const what = decodeCall(node);

        if (what !== null) report(node, what);
      },
      ImportDeclaration(node) {
        if (MERMAID.test(node.source.value) && !isTypeOnly(node))
          context.report({ node, message: MERMAID_MESSAGE });
      },
      ImportExpression(node) {
        if (MERMAID.test(stringOf(node.source) ?? ""))
          context.report({ node, message: MERMAID_MESSAGE });
      },
    };
  },
};

const isProcessEnv = (node) =>
  node?.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === "process" &&
  node.property.type === "Identifier" &&
  node.property.name === "env";

/** `process.env` that names one variable (`process.env.X`) or is a parameter's default. */
const readsOneOrDefaults = (node) =>
  (node.parent?.type === "MemberExpression" && node.parent.object === node) ||
  (node.parent?.type === "AssignmentPattern" && node.parent.right === node);

const ENV_MESSAGE =
  "A child that runs a repository's code gets an allowlisted environment, never the Daemon's: " +
  "pass process.env only to one of the builders in allowlist.mjs (repositoryEnv, setupEnv, readOnlyEnv).";

const SPAWN_ENV_MESSAGE =
  "This spawn would inherit the Daemon's environment: give it `env:` from an allowlisted builder.";

const repositoryEnv = {
  meta: {
    type: "problem",
    schema: OPTIONS,
    docs: { description: "Children that run repository code get only an allowlisted env." },
  },
  create(context) {
    const { config, checked } = placement(context, REPOSITORY_ENV);

    if (!checked) return {};

    const builders = new Set(config.builders);

    const isBuilderArgument = (node) =>
      node.parent?.type === "CallExpression" &&
      node.parent.arguments.includes(node) &&
      builders.has(calleeName(node.parent.callee));

    return {
      MemberExpression(node) {
        if (isProcessEnv(node) && !readsOneOrDefaults(node) && !isBuilderArgument(node))
          context.report({ node, message: ENV_MESSAGE });
      },
      CallExpression(node) {
        const name = calleeName(node.callee);

        if (name === "childEnv") context.report({ node, message: ENV_MESSAGE });

        if (spawner(node) === null || node.arguments.length === 0) return;

        const options = node.arguments.find((a) => a.type === "ObjectExpression");
        const env = options?.properties.find((p) => p.type === "Property" && keyName(p) === "env");

        if (env === undefined) context.report({ node, message: SPAWN_ENV_MESSAGE });
      },
    };
  },
};

export default {
  meta: { name: "security" },
  rules: {
    "git-spawn": gitSpawn,
    "git-config-mode": gitConfigMode,
    "image-decode": imageDecode,
    "repository-env": repositoryEnv,
    "spawn-path": spawnPath,
  },
};
