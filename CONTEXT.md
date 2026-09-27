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
The native GPUI Client.

**Mobile App**:
A future phone Client for starting and supervising Agent Sessions on a Host.

### Agents

**Harness**:
A third-party agent program (Claude Code, Codex) that performs agent work; Polaris drives Harnesses and never reimplements one.
_Avoid_: Agent runtime, backend

**Agent Session**:
One conversation with one Harness on one Host, as supervised by Polaris.
_Avoid_: Thread, chat, run

### Views

**Orchestrator**:
The view for launching, monitoring, and steering Agent Sessions.
_Avoid_: Dashboard, agent manager

**Editor**:
The view for reading, editing, and reviewing code, including inline chat and tab completion.
