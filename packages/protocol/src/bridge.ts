/**
 * Constants `polaris bridge` shares with Clients. Kept free of imports, so the
 * bridge (a process per remote Client, alive as long as it stays connected)
 * can use them without loading Effect and the protocol schemas:
 * `import { … } from "@polaris/protocol/bridge"`.
 */

/**
 * Exit status of `polaris bridge` when nothing is listening on the Daemon
 * socket (EX_UNAVAILABLE), so a Client can tell "no Daemon" apart from an SSH
 * failure and show the Host as Needs Attention.
 */
export const BRIDGE_EXIT_NO_DAEMON = 69
