# Polaris

A native, GPU-rendered IDE and agent orchestrator (codename). It combines a code editor with a view for running and supervising coding agents across local and remote machines.

## Language

### Machines

**Host**:
A machine where code lives and agents run: the local Mac or a remote machine such as a Linux VM.
_Avoid_: Server, box, remote

**Daemon**:
The headless Polaris process running on a Host; it owns that Host's Agent Sessions, files, and language tooling.
_Avoid_: Backend, agent server

**Client**:
A user-facing Polaris front end (the Desktop App, and later the Mobile App) that connects to one or more Daemons.
_Avoid_: Frontend, UI

**Desktop App**:
The macOS Client: a single main window in which the user moves between orchestrating, reviewing, and editing across all connected Hosts.
_Avoid_: IDE window, workspace window

**Mobile App**:
A future phone Client for starting and supervising Agent Sessions on a Host.

**Connection State**:
How a Client's link to one Host's Daemon stands right now: exactly one of Connected, Reconnecting, Needs Attention, or Offline; independent of any Session State on that Host.
_Avoid_: Status (unqualified), online/offline (as the only states)

**Connected**:
The Connection State in which the Client has a live link to the Host's Daemon.

**Reconnecting**:
The Connection State in which the link dropped and the Client is retrying on its own, without prompting, while showing the Host's last known state dimmed.
_Avoid_: Disconnected

**Needs Attention**:
The Connection State in which the Client cannot reconnect or install without the user, such as a changed host key, a password or 2FA prompt, or a first install awaiting approval; shown inline on the Host, never as a blocking dialog.
_Avoid_: Error, disconnected

**Offline**:
The Connection State of a Host the Client has stopped retrying, such as a machine that is shut down.

### Agents

**Harness**:
A third-party agent program (Claude Code, Codex, OpenCode) that performs agent work; Polaris drives Harnesses and never reimplements one.
_Avoid_: Agent runtime, backend

**Model**:
A language model a Harness offers to run on, named as that Harness names it; chosen when an Agent Session starts and changeable between Turns, and each Turn records the Model it ran on.
_Avoid_: LLM, provider (when meaning the model)

**Usage**:
The tokens, and the cost where known, consumed by Harness work on a Host, whether or not it ran in an Agent Session, grouped by Harness and Model; a cost the Harness did not report is an estimate, and subscription Usage is shown as its API-equivalent, never as money spent.
_Avoid_: Spend, billing, credits

**Plan Limit**:
A cap a provider's subscription puts on Usage over a time window (such as five hours or a week), shown as how much is used and when it resets; known only from what the Harness reports.
_Avoid_: Rate limit, quota, allowance

**Skill**:
A packaged set of instructions a Harness loads by name when asked (a `SKILL.md` folder for Claude Code and Codex); the user invokes one from the composer and it rides in the Turn.
_Avoid_: Plugin, tool (when meaning a Skill)

**Slash Command**:
A named action a Harness offers as `/name` (built in, the user's own, the Workspace's, or a plugin's); Polaris runs each the way the Harness expects: as Turn text, through the Harness's own call, as a Polaris action, or not at all when only its terminal UI can.
_Avoid_: Command (that is what a Client sends the Daemon), macro

**Workspace**:
A directory on a Host that the user has registered with Polaris, usually a git repository; Agent Sessions and Review Checkouts belong to one. It persists (hidden when idle) until the user removes it.
_Avoid_: Project, folder, repo (when meaning the registered directory)

**Agent Session**:
One durable conversation with one Harness in one Workspace, as supervised by Polaris; it outlives the Harness process and Daemon restarts, and never changes Harness.
_Avoid_: Thread, chat, run

**Worktree**:
A git worktree of a Workspace, tracked by Polaris wherever it lives on disk (whether Polaris, the user, or a Harness created it) and shown under the Agent Session that created it.

**Turn**:
One message from the user plus everything the Harness does in response; the unit that gets a checkpoint, a diff, and a Review.
_Avoid_: Step, exchange

**Fork**:
A new Agent Session started from a checkpoint of another, linked to its parent; the way to switch Harness or retry differently.

**Session State**:
Where an Agent Session stands right now: exactly one of Starting, Working, Needs You, Idle, In Terminal, Dormant, Failed, or Archived.
_Avoid_: Status (unqualified), phase

**Starting**:
The state of an Agent Session whose Harness process is being launched or resumed and cannot yet take a Turn.

**Working**:
The state of an Agent Session whose Harness is in the middle of a Turn.
_Avoid_: Running, busy, thinking

**Needs You**:
The state of an Agent Session whose Harness is blocked on the user, waiting for a permission grant or an answer.
_Avoid_: Blocked, waiting, pending

**Idle**:
The state of an Agent Session whose last Turn has finished while its Harness process is still running.
_Avoid_: Done, complete

**In Terminal**:
The state of an Agent Session the user has taken over in the Harness's own terminal UI; Polaris follows along but does not send Turns until the user hands it back.
_Avoid_: Detached, external

**Dormant**:
The state of an Agent Session whose Harness process is not running but which can be resumed on demand or automatically.

**Failed**:
The state of an Agent Session whose Harness process crashed or errored out of a Turn.
_Avoid_: Errored, dead

**Archived**:
The state of an Agent Session the user has put away after reviewing or merging its work; there is no "Done".
_Avoid_: Closed, deleted

### Constellations

**Constellation**:
A directed acyclic graph of Tasks owned by one orchestrating Agent Session, mapped by that session or the user, that says what work exists, in what order, and what must pass before it ships; a Workspace can have several at once.
_Avoid_: Plan, run, workflow, pipeline

**Lead**:
The Agent Session that owns a Constellation: it maps the Tasks, starts their Attempts, hears their outcomes and can hand the Constellation over to a new Lead.
_Avoid_: Orchestrator (that is the view), conductor, parent

**Task**:
A stable unit of work in a Constellation, with dependencies on other Tasks; it is carried out by one or more Attempts, and its state follows its latest Attempt.
_Avoid_: Job, step, ticket

**Attempt**:
One try at a Task, carried out by one Agent Session and linked to the earlier Attempt it follows (for example, sent back after review); a retry is a new Attempt, never a rewrite of an old one.
_Avoid_: Retry, run

**Gate**:
A Task that waits for several other Tasks to finish (fan-in), such as "tiles merged to main", before the Constellation moves on.
_Avoid_: Milestone, checkpoint

**Future**:
A Task a Constellation has declared but not yet started, shown as intent rather than work.

**Subagent**:
A helper a Harness spawns inside an Agent Session; Polaris shows it under its parent and lets the user view it on its own.

### Views

**Orchestrator**:
The view for launching, monitoring, and steering Agent Sessions.
_Avoid_: Dashboard, agent manager

**Review**:
The view for judging a set of changes (an open pull request or an Agent Session's work) before accepting it, guided by a Risk Summary.
_Avoid_: Code review panel, diff viewer

**Review Checkout**:
A separate worktree on the Host holding the changes under Review, so they can be run locally without touching the user's own working tree.
_Avoid_: Checkout, PR branch

**Risk Summary**:
A ranked set of Risk Findings for the change under Review, combining rules, classifiers, and an agent's judgement, pointing a human at what most needs their eyes.

**Risk Finding**:
One flagged location in a change, with its source (Rule, Classifier, or Agent), Severity, confidence, reason, and status (Open, Dismissed, Resolved).
_Avoid_: Issue, warning, comment

**Reviewer**:
The Harness and Model the user chooses to write the Agent part of every Risk Summary, set once in Settings and independent of the Harness that made the change.
_Avoid_: Review agent, review bot

**Walkthrough**:
Polaris's read-only account of a change under Review, written by its own session beside the Reviewer: why the change, the few things to note, and an outline of only the views that explain it. Kept per head commit; a re-review adds a short one covering only the new commits.
_Avoid_: Summary (that is the Risk Summary), PR description

**Overview**:
The tab a Review opens on: a pull request's description, a review bot's pinned summary and the Walkthrough, or an Agent Session's prompts and the Walkthrough.
_Avoid_: Summary tab, details

**Severity**:
How bad a Risk Finding would be if real: exactly one of Critical, High, Medium, or Low; a Risk Summary ranks by Severity, then confidence.
_Avoid_: Priority, P0–P3 (in anything a user reads), level

**Critical**:
The Severity for secrets, security holes, and data loss; no Risk Memory may ever hide a Critical Finding. A secret is Critical when the scanner is confident it is a credential; its low-confidence generic matches (a word like "password" in a label) are Medium, so they can be dismissed.
_Avoid_: Blocker, P0

**High**:
The Severity for a likely bug or breaking change.

**Medium**:
The Severity for something worth a human's look, such as a risky pattern or hard-to-maintain code.

**Low**:
The Severity for nits, style, and unnecessary comments.
_Avoid_: Nit (as a Severity name), info

**Verdict**:
The user's thumbs-up or thumbs-down on a Risk Finding; a thumbs-down carries reason badges or free text and a scope (this change, this repo, everywhere), and Verdicts are what the reviewer learns from.
_Avoid_: Dismissal, feedback, rating

**Risk Memory**:
A scoped review instruction learned from Verdicts that only takes effect once the user approves it; kept either committed in the repo or privately on the Host.
_Avoid_: Learning, suppression rule

**Editor**:
The view for reading and editing code, including inline chat and tab completion.
