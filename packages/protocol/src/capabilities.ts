import { Schema } from "effect"

/** Bumped only for changes capability negotiation can't absorb. */
export const PROTOCOL_VERSION = 1

/**
 * Features negotiated in `hello`. A Client hides what a Daemon lacks, so an
 * older Daemon keeps working until the Desktop App upgrades it.
 */
export const Capability = Schema.Literals([
  "harness.claude",
  "harness.codex",
  "session.steer",
  "session.fork",
  "session.terminal-handoff",
  "files.read",
  "files.search",
  "files.watch",
  "git.diff",
  "attachments.stage",
  "terminal",
  "blobs",
])
export type Capability = typeof Capability.Type
