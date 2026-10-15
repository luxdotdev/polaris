---
status: proposed (owner asked for it, 2026-10-15; pending the owner's review of the mockups)
reverses: the v1 rule "Polaris never starts, stops or downloads a model server"
---

# Polaris downloads and runs the tab completion model server

Tab completion v1 and v1.1 only worked for a user who already ran llama-server,
Ollama or LM Studio themselves. On the owner's Mac it worked because a shell in
another session kept llama-server up. A new user had no path. The owner asked for
a one-click setup that runs the first time tab completion is turned on: Polaris
gets the model and the server running itself.

This reverses the v1 rule in DESIGN.md "Tab completion v1" and its status card,
`packages/predict/README.md`, `apps/daemon/src/prediction/README.md` and
`docs/specs/edit-prediction-v1.1.md` §2. Discovery of a user's own server stays as
the advanced path ("Use my own model server").

## Decision

**Where.** The Daemon of the machine that serves. Placement already picks a side:
the Client side is this Mac's local Daemon, the Host side is a remote Host's. One
implementation in the Daemon (`apps/daemon/src/prediction/managed/`), so a Linux VM
or a Mac Studio gets it too. Raspberry Pi-class Hosts stay "too small" and never
offer setup. Windows has no local Daemon, so there the Host side serves.

**What runs.** `llama-server` from llama.cpp release `b11429` (the `v0.6.0` stable
build, commit `d812350`, MIT), downloaded per platform from the GitHub Release with a
pinned SHA-256 (`catalog.ts`): macOS arm64, Linux x64, Linux arm64 (glibc). Other
platforms report "no managed server for this platform". The archive is verified,
then extracted with the Host's `tar` into the model folder. Flags from the spike:
`-c 8192 -np 1 -ngl 99 --cache-reuse 256 --spec-type ngram-simple
--spec-ngram-simple-size-n 8 --spec-ngram-simple-size-m 48`, plus `--alias` so the
endpoint reports a recognisable model id. It binds `127.0.0.1` on a free port picked
once per Daemon run (never 8080, 1234 or 11434, the discovery ports). Downloading
beats bundling: the three archives are 12 to 18 MB each and change with llama.cpp,
and the app must not grow for a feature that is off by default.

**Which model.** One per machine, and only a next-edit model, which also handles plain
insertion, so no FIM model is ever installed beside it (the owner ruled ~16 GB for
completion too much). The default on every machine is Sweep Next-Edit 1.5B Q8_0
(1.54 GB on disk, about 2.6 GB in memory, `sweepai/sweep-next-edit-1.5B`, Apache-2.0);
the owner's decision of 2026-10-15, replacing the spec's RAM rule. Zeta 2.1 Q4_K_M
(5.07 GB on disk, about 7–9 GB in memory, `mradermacher/zeta-2.1-GGUF`, Apache-2.0, base
`zed-industries/zeta-2.1` Apache-2.0) is an opt-in "higher quality" choice in Settings,
shown with that memory cost; the setup downloads it only when chosen. Polaris downloads
from the publisher on the user's machine; it redistributes nothing. Both licences allow
it; a non-permissive model would be refused here.

**Disk.** Free space is checked before the download and shown in the setup step. The
model folder defaults to `~/.polaris/models` on the serving machine and can be any
folder (an external drive is the owner's real case). Downloads resume with `Range`
from a `.part` file, report progress, can be cancelled, are hashed whole before an
atomic rename, and a file already in the folder with the right size and hash counts
as downloaded. "Remove downloaded model" deletes the model and the server build.

**Lifecycle.** A managed server is a lifecycle, so it is a state machine
(`machine.ts`, XState v6, a pure decider like the language-process one): Absent,
Downloading, Verifying, Stopped, Starting, Serving, Backoff, Failed. It starts
lazily on the first completion request, is restarted after a crash with backoff
(1 s doubling to 30 s, five tries), stops when tab completion is turned off, and
unloads after 15 minutes without a request. The status card and Settings say when it
is loading. The idle timer is the only timer: it exists only while a server runs and
is reset by requests, so an idle Daemon with no server wakes for nothing (`idle`
bench unchanged). Health is polled only while Starting.

**Placement.** The capability report lists the managed endpoint with `managed: true`
even while the server is stopped; placement prefers it over discovered servers on
the same side. A next-edit model already served by the user's own server is
preferred over downloading at setup time (the setup step is not offered then).

**Protocol.** `prediction.managed` (status and actions: setup, cancel, start, stop,
remove) and `prediction.managed.watch` (a status stream), capability
`prediction.managed`. All of it is ephemeral: nothing enters the event log, the
Daemon rediscovers what is on disk from the folder the Client names.

## Brief (product-design skill)

- **User and moment:** the developer turning tab completion on for the first time,
  from Settings or the status card, who wants to type and get completions without
  learning what llama-server is.
- **Job:** say what will happen (which model, how big, which machine, how much space
  is free), do it on one button, show progress where the user already looks (the
  status card and Settings), end in v1's "ready" state.
- **Domain objects:** Host (the serving machine, by its Host name), Daemon, the model
  server, tab completion. Copy lowercases glossary words.
- **Authority:** the serving Daemon owns the lifecycle and reports it; the Desktop App
  owns preferences (folder, enable); the user owns the decision to download.
- **Consequence and reversibility:** a 1.5 or 5.1 GB download and a process on that
  machine. "Remove downloaded model" undoes it; turning tab completion off stops it.
- **Non-goals:** GPU builds (CUDA, Vulkan), more than one model per machine, picking a
  model by hand in setup (Settings' Model list still overrides placement).
- **Open decisions:** the 15-minute idle unload length; whether a remote Host's folder
  should be browsable (it is a path field today).

## States (resilience reference)

Each is reachable from the serving machine's status and the Host's Connection State,
and each has a Paper artboard (TS1 to TS8, dark and light):

| State | Status card | Settings |
|---|---|---|
| Setup | "Set up tab completion" · "Polaris will download Zeta 2.1 (5.1 GB) to ~/.polaris/models on this Mac · 211 GB free" · primary "Download Zeta 2.1" | the same, with the folder field and "Use my own model server" |
| Downloading | "Downloading Zeta 2.1…" · progress bar, "1.2 of 5.1 GB" · "Cancel download" | inline progress in the enable row's group |
| Loading | "Loading Zeta 2.1…" · "The model server is starting on this Mac." | caption "Loading Zeta 2.1…" |
| Ready | v1's "Tab completion is ready" with Endpoint "managed by Polaris" | "Served by this Mac · Zeta 2.1" |
| No space | "Not enough space" · "Zeta 2.1 needs 5.1 GB; 2.6 GB is free on this Mac." · "Choose another folder" | the same, folder field focused |
| Download failed | "The download stopped" · the reason · "Resume download" | the same |
| Checksum mismatch | "The download didn't verify" · "Download again" (the file is discarded) | the same |
| Server won't start | "The model server won't start" · last log lines in mono · "Try again" | the same |
| Host offline / reconnecting | v1's offline and reconnecting cards; the download keeps going on the Host | the row's Connection State |
| Host too small | "{Host} is too small to serve" · "Choose this Mac or another host" | "This host is too small to serve" |

## Consequences

- The Daemon gains a child process it owns on demand, a download with resume, and one
  idle timer. `apps/daemon/src/prediction/README.md` and `packages/bench/README.md`
  record the timer's justification.
- Settings' Model server section becomes "Use my own model server", collapsed.
- The status card's model list shows model names ("Zeta 2.1", "Mellum2") with the raw
  id as a tooltip, and the memory line names each server with what it holds, so an
  idle Ollama is no longer "33 MB" standing for three servers.
