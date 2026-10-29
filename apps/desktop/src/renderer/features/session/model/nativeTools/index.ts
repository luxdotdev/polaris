/**
 * Claude Code's own tools in words (DESIGN.md, Tool runs): each one's row verb, its subject
 * and its phrase in a run's summary ("messaged 2 subagents", "stopped a task"). Inputs are
 * decoded with a Schema per tool; a call whose input doesn't decode keeps the generic row.
 */
import { Option, Predicate, Schema } from "effect";
import { plural } from "../format.ts";
import { serverName, type ToolInput } from "../toolCalls/index.ts";

/** A native call as the conversation reads it: who or what it acted on, and what it said. */
export interface NativeCall {
  /** The tool's name, as Claude Code calls it (`SendMessage`). */
  readonly tool: string;
  /** The Subagent, task or schedule it addressed, when it names one. */
  readonly target: string | null;
  readonly text: string;
}

interface Subject {
  readonly target?: string | null | undefined;
  readonly text?: string | undefined;
}

type Phrase = (n: number) => string;

interface NativeTool {
  readonly verbs: readonly [running: string, done: string];
  /** Its phrase in a run's summary for `n` calls; null when it keeps its own row. */
  readonly phrase: Phrase | null;
  readonly decode: (input: ToolInput) => Option.Option<Subject>;
}

const native = <A>(
  schema: Schema.Decoder<A>,
  verbs: readonly [string, string],
  phrase: Phrase | null,
  subject: (input: A) => Subject = () => ({})
): NativeTool => {
  const decode = Schema.decodeUnknownOption(schema);

  return { verbs, phrase, decode: (input) => Option.map(decode(input), subject) };
};

/** "messaged a subagent", "messaged 2 subagents". */
const counted =
  (verb: string, noun: string, article = "a"): Phrase =>
  (n) =>
    n === 1 ? `${verb} ${article} ${noun}` : `${verb} ${plural(n, noun)}`;

/** "listed agents", "listed agents 3 times". */
const repeated =
  (phrase: string): Phrase =>
  (n) =>
    n === 1 ? phrase : `${phrase} ${n} times`;

const firstLine = (text: string) =>
  text
    .trim()
    .split("\n")[0]
    ?.replace(/^#+\s*/, "")
    .trim() ?? "";

const words = (name: string) => name.replaceAll(/[_-]+/g, " ").toLowerCase();

const Text = Schema.String;

const NonBlank = Schema.String.check(Schema.isPattern(/\S/));

const Empty = Schema.Struct({});

const MESSAGED = counted("messaged", "subagent");

const STOPPED = counted("stopped", "task");

const CHECKED = counted("checked", "background task");

const SendMessage = Schema.Struct({
  to: NonBlank,
  summary: Schema.optional(NonBlank),
  message: Schema.optional(Schema.Unknown),
});

const messageText = (input: typeof SendMessage.Type) =>
  input.summary ?? (Predicate.isString(input.message) ? firstLine(input.message) : "");

/** Every native tool the conversation phrases, by its Claude Code name. */
const TOOLS = new Map<string, NativeTool>([
  [
    "SendMessage",
    native(SendMessage, ["Messaging", "Messaged"], MESSAGED, (i) => ({
      target: i.to,
      text: messageText(i),
    })),
  ],
  ["ListAgents", native(Empty, ["Listing agents", "Listed agents"], repeated("listed agents"))],
  [
    "TaskStop",
    native(
      Schema.Struct({ task_id: Schema.optional(NonBlank), shell_id: Schema.optional(NonBlank) }),
      ["Stopping a task", "Stopped a task"],
      STOPPED,
      (i) => ({ target: i.task_id ?? i.shell_id ?? null })
    ),
  ],
  [
    "KillShell",
    native(
      Schema.Struct({ shell_id: NonBlank }),
      ["Stopping a task", "Stopped a task"],
      STOPPED,
      (i) => ({ target: i.shell_id })
    ),
  ],
  [
    "TaskOutput",
    native(
      Schema.Struct({ task_id: NonBlank }),
      ["Checking a background task", "Checked a background task"],
      CHECKED,
      (i) => ({ target: i.task_id })
    ),
  ],
  [
    "BashOutput",
    native(
      Schema.Struct({ bash_id: NonBlank }),
      ["Checking a background task", "Checked a background task"],
      CHECKED,
      (i) => ({ target: i.bash_id })
    ),
  ],
  [
    "Agent",
    native(
      Schema.Struct({ description: Text }),
      ["Starting a subagent", "Started a subagent"],
      null,
      (i) => ({ text: i.description })
    ),
  ],
  [
    "Task",
    native(
      Schema.Struct({ description: Text }),
      ["Starting a subagent", "Started a subagent"],
      null,
      (i) => ({ text: i.description })
    ),
  ],
  [
    "TodoWrite",
    native(
      Schema.Struct({ todos: Schema.Array(Schema.Unknown) }),
      ["Updating the todo list", "Updated the todo list"],
      repeated("updated the todo list"),
      (i) => ({ text: plural(i.todos.length, "todo") })
    ),
  ],
  [
    "AskUserQuestion",
    native(
      Schema.Struct({ questions: Schema.Array(Schema.Struct({ question: Text })) }),
      ["Asking you", "Asked you"],
      counted("asked you", "question"),
      (i) => ({ text: i.questions[0]?.question ?? "" })
    ),
  ],
  [
    "EnterPlanMode",
    native(Empty, ["Entering plan mode", "Entered plan mode"], repeated("entered plan mode")),
  ],
  [
    "ExitPlanMode",
    native(
      Schema.Struct({ plan: Schema.optional(Text) }),
      ["Proposing a plan", "Proposed a plan"],
      counted("proposed", "plan"),
      (i) => ({ text: firstLine(i.plan ?? "") })
    ),
  ],
  [
    "EnterWorktree",
    native(
      Schema.Struct({ name: Schema.optional(Text), path: Schema.optional(Text) }),
      ["Entering a worktree", "Entered a worktree"],
      counted("entered", "worktree"),
      (i) => ({ text: i.name ?? i.path ?? "" })
    ),
  ],
  [
    "ExitWorktree",
    native(
      Schema.Struct({ action: Schema.Literals(["keep", "remove"]) }),
      ["Leaving the worktree", "Left the worktree"],
      repeated("left the worktree"),
      (i) => ({ text: i.action === "remove" ? "removed" : "kept" })
    ),
  ],
  [
    "CronCreate",
    native(
      Schema.Struct({ cron: NonBlank, prompt: Text }),
      ["Scheduling a prompt", "Scheduled a prompt"],
      counted("scheduled", "prompt"),
      (i) => ({ text: [i.cron, firstLine(i.prompt)].filter((t) => t !== "").join(" · ") })
    ),
  ],
  [
    "CronDelete",
    native(
      Schema.Struct({ id: Text }),
      ["Deleting a schedule", "Deleted a schedule"],
      counted("deleted", "schedule")
    ),
  ],
  [
    "CronList",
    native(Empty, ["Listing schedules", "Listed schedules"], repeated("listed schedules")),
  ],
  [
    "ScheduleWakeup",
    native(
      Schema.Struct({ reason: Schema.optional(Text), stop: Schema.optional(Schema.Boolean) }),
      ["Scheduling a wakeup", "Scheduled a wakeup"],
      counted("scheduled", "wakeup"),
      (i) => ({ text: i.stop === true ? "ended the loop" : (i.reason ?? "") })
    ),
  ],
  [
    "Monitor",
    native(
      Schema.Struct({ description: Text }),
      ["Starting a monitor", "Started a monitor"],
      counted("started", "monitor"),
      (i) => ({ text: i.description })
    ),
  ],
  [
    "LSP",
    native(
      Schema.Struct({ operation: Text, filePath: Text }),
      ["Querying the language server", "Queried the language server"],
      repeated("queried the language server"),
      (i) => ({ text: `${words(i.operation)} · ${i.filePath}` })
    ),
  ],
  [
    "TaskCreate",
    native(
      Schema.Struct({ subject: Text }),
      ["Adding a todo", "Added a todo"],
      counted("added", "todo"),
      (i) => ({ text: i.subject })
    ),
  ],
  [
    "TaskUpdate",
    native(
      Schema.Struct({
        taskId: Text,
        subject: Schema.optional(Text),
        status: Schema.optional(Text),
      }),
      ["Updating a todo", "Updated a todo"],
      counted("updated", "todo"),
      (i) => ({ text: i.subject ?? words(i.status ?? "") })
    ),
  ],
  [
    "TaskGet",
    native(
      Schema.Struct({ taskId: Text }),
      ["Reading a todo", "Read a todo"],
      counted("read", "todo")
    ),
  ],
  ["TaskList", native(Empty, ["Listing todos", "Listed todos"], repeated("listed todos"))],
  [
    "ListMcpResourcesTool",
    native(
      Schema.Struct({ server: Schema.optional(Text) }),
      ["Listing MCP resources", "Listed MCP resources"],
      repeated("listed MCP resources"),
      (i) => ({ text: i.server === undefined ? "" : serverName(i.server) })
    ),
  ],
  [
    "ReadMcpResourceTool",
    native(
      Schema.Struct({ server: Text, uri: Text }),
      ["Reading an MCP resource", "Read an MCP resource"],
      counted("read", "MCP resource", "an"),
      (i) => ({ text: `${serverName(i.server)} · ${i.uri}` })
    ),
  ],
  [
    "Workflow",
    native(
      Schema.Struct({
        title: Schema.optional(Text),
        name: Schema.optional(Text),
        description: Schema.optional(Text),
      }),
      ["Starting a workflow", "Started a workflow"],
      counted("started", "workflow"),
      (i) => ({ text: i.title ?? i.name ?? i.description ?? "" })
    ),
  ],
  [
    "RemoteTrigger",
    native(
      Schema.Struct({ action: Text }),
      ["Using remote triggers", "Used remote triggers"],
      repeated("used remote triggers"),
      (i) => ({ text: words(i.action) })
    ),
  ],
  [
    "PushNotification",
    native(
      Schema.Struct({ message: Text }),
      ["Sending a notification", "Sent a notification"],
      counted("sent", "notification"),
      (i) => ({ text: firstLine(i.message) })
    ),
  ],
  [
    "SendFeedback",
    native(
      Schema.Struct({ title: Text }),
      ["Sending feedback", "Sent feedback"],
      repeated("sent feedback"),
      (i) => ({ text: i.title })
    ),
  ],
  [
    "ReportFindings",
    native(
      Schema.Struct({ findings: Schema.Array(Schema.Unknown) }),
      ["Reporting findings", "Reported findings"],
      repeated("reported findings"),
      (i) => ({ text: plural(i.findings.length, "finding") })
    ),
  ],
  [
    "ProposeGoal",
    native(
      Schema.Struct({ condition: Text }),
      ["Proposing a goal", "Proposed a goal"],
      counted("proposed", "goal"),
      (i) => ({ text: firstLine(i.condition) })
    ),
  ],
  [
    "ProposeSkills",
    native(
      Schema.Struct({ proposals: Schema.Array(Schema.Unknown) }),
      ["Proposing skills", "Proposed skills"],
      repeated("proposed skills"),
      (i) => ({ text: plural(i.proposals.length, "skill") })
    ),
  ],
  [
    "Artifact",
    native(
      Schema.Struct({
        action: Schema.optional(Text),
        title: Schema.optional(Text),
        file_path: Schema.optional(Text),
      }),
      ["Working on an artifact", "Worked on an artifact"],
      counted("worked on", "artifact", "an"),
      (i) => ({ text: i.title ?? i.file_path ?? words(i.action ?? "") })
    ),
  ],
  [
    "ReadNotifications",
    native(Empty, ["Reading notifications", "Read notifications"], repeated("read notifications")),
  ],
  [
    "Projects",
    native(
      Schema.Struct({ method: Text, path: Schema.optional(Text) }),
      ["Using projects", "Used projects"],
      repeated("used projects"),
      (i) => ({ text: [words(i.method), i.path ?? ""].filter((t) => t !== "").join(" · ") })
    ),
  ],
  [
    "ClaudeDesign",
    native(
      Schema.Struct({ operation: Text }),
      ["Using Claude Design", "Used Claude Design"],
      repeated("used Claude Design"),
      (i) => ({ text: words(i.operation) })
    ),
  ],
  [
    "ShowOnboardingRolePicker",
    native(
      Empty,
      ["Showing the role picker", "Showed the role picker"],
      repeated("showed the role picker")
    ),
  ],
]);

/** The tools the registry phrases, for tests and the design spec. */
export const NATIVE_TOOLS: ReadonlyArray<string> = [...TOOLS.keys()];

/** A native call's reading; null for any other tool, or when its input doesn't decode. */
export const nativeCall = (name: string, input: ToolInput): NativeCall | null => {
  const tool = TOOLS.get(name);

  if (tool === undefined) return null;

  return Option.match(tool.decode(input), {
    onNone: () => null,
    onSome: (s) => ({ tool: name, target: s.target ?? null, text: s.text ?? "" }),
  });
};

/** Its row's verb: "Messaged", "Stopping a task". */
export const nativeVerb = (call: NativeCall, running: boolean): string => {
  const verbs = TOOLS.get(call.tool)?.verbs;

  return verbs === undefined ? call.tool : verbs[running ? 0 : 1];
};

/** Whether it folds into a run; a call that spawns a Subagent keeps its row, the card's place. */
export const nativeJoinsRuns = (call: NativeCall): boolean =>
  (TOOLS.get(call.tool)?.phrase ?? null) !== null;

/** Its row's subject: the recipient, then what it said ("Fix tests · rebase on main"). */
export const nativeSummary = (call: NativeCall): string =>
  [call.target ?? "", call.text].filter((t) => t !== "").join(" · ");

/** One phrase per kind of call, in the order the run first made one; tools sharing one add up. */
export const nativePhrases = (calls: ReadonlyArray<NativeCall>): ReadonlyArray<string> => {
  const counts = new Map<Phrase, number>();

  for (const call of calls) {
    const phrase = TOOLS.get(call.tool)?.phrase ?? null;

    if (phrase !== null) counts.set(phrase, (counts.get(phrase) ?? 0) + 1);
  }

  return [...counts].map(([phrase, n]) => phrase(n));
};

/** The call with its target named: a Subagent's title in place of its id or name. */
export const withRecipient = (
  call: NativeCall,
  titles: ReadonlyMap<string, string>
): NativeCall => {
  const title = call.target === null ? undefined : titles.get(call.target);

  return title === undefined ? call : { ...call, target: title };
};
