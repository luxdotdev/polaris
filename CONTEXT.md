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

### Agents

**Harness**:
A third-party agent program (Claude Code, Codex) that performs agent work; Polaris drives Harnesses and never reimplements one.
_Avoid_: Agent runtime, backend

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

**Severity**:
How bad a Risk Finding would be if real: exactly one of Critical, High, Medium, or Low; a Risk Summary ranks by Severity, then confidence.
_Avoid_: Priority, P0–P3 (in anything a user reads), level

**Critical**:
The Severity for secrets, security holes, and data loss; no Risk Memory may ever hide a Critical Finding.
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
