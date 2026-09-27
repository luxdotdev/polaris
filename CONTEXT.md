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
A directory on a Host that the user has registered with Polaris, usually a git repository; Agent Sessions and Review Checkouts belong to one.
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

**Dormant**:
The state of an Agent Session whose Harness process is not running but which can be resumed on demand or automatically.

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
An agent-written account of which parts of a change carry the most risk and most need a human's eyes.

**Editor**:
The view for reading and editing code, including inline chat and tab completion.
