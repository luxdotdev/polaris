import { Schema, SchemaTransformation } from "effect";
import { HARNESS_CATALOGUE } from "./harnesses.ts";

/** Bumped only for changes capability negotiation can't absorb. */
export const PROTOCOL_VERSION = 1;

/**
 * Features negotiated in `hello`. A Client hides what a Daemon lacks, so an
 * older Daemon keeps working until the Desktop App upgrades it.
 */
export const Capability = Schema.Literals([
  /** `harness.<kind>`: the Daemon has that Harness's driver (one per catalogue entry). */
  ...HARNESS_CATALOGUE.map((harness) => harness.capability),
  /** `harness.models`: each Harness's Models on this Host. */
  "harness.models",
  /** `harness.availability` and `harness.watchAvailability`: each Harness's status on this Host. */
  "harness.availability",
  "session.steer",
  "session.fork",
  /** The `SetModel` command. */
  "session.set-model",
  "session.terminal-handoff",
  /** `session.terminalCommand`: the argv, cwd and env of the Harness TUI for "Open in terminal". */
  "session.terminal-command",
  /**
   * `ItemProgress` on session streams (running commands, live plans). A Client
   * announces it in `hello`; the Daemon only sends `ItemProgress` to Clients that did.
   */
  "session.live-items",
  /**
   * Subagents: `SubagentStarted`/`SubagentEnded`, a Subagent's own items (with a
   * `subagentId`), and `TurnDetail.subagents`. A Client announces it in `hello`;
   * the Daemon leaves all of these out for Clients that didn't.
   */
  "session.subagents",
  "files.read",
  "files.search",
  "files.watch",
  "git.diff",
  "attachments.stage",
  "terminal",
  /** `terminal.attachBinary`: terminal output as raw bytes on the blob channel, not base64 JSON. */
  "terminal.binary",
  "blobs",
  /** `usage.query` and `usage.watch`: Usage and Plan Limits on this Host. */
  "usage",
]);

export type Capability = typeof Capability.Type;

const isCapability = Schema.is(Capability);

/**
 * A capability list as it travels in `hello`. Names this build doesn't know are
 * dropped on decode instead of failing, so a newer Client can talk to an older
 * Daemon (and vice versa) and simply not use what the other side lacks.
 */
export const CapabilityList = Schema.Array(Schema.String).pipe(
  Schema.decodeTo(
    Schema.Array(Capability),
    SchemaTransformation.transform<ReadonlyArray<Capability>, ReadonlyArray<string>>({
      decode: (names) => names.filter(isCapability),
      encode: (capabilities) => capabilities,
    })
  )
);
