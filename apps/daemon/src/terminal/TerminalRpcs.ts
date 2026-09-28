/**
 * Handlers for `terminal.open/attach/input/resize/close`.
 */
import {
  TerminalAttach,
  TerminalClose,
  TerminalInput,
  TerminalOpen,
  TerminalResize,
} from "@polaris/protocol"
import { Effect } from "effect"
import { RpcGroup } from "effect/rpc"
import { Terminals } from "./Terminals.ts"

export class TerminalRpcs extends RpcGroup.make(
  TerminalOpen,
  TerminalAttach,
  TerminalInput,
  TerminalResize,
  TerminalClose,
) {}

/** Requires `Terminals` (from `TerminalsLive`). */
export const TerminalRpcsLive = TerminalRpcs.toLayer(
  Effect.gen(function* () {
    const terminals = yield* Terminals
    return TerminalRpcs.of({
      "terminal.open": (payload) =>
        Effect.map(terminals.open(payload), (terminalId) => ({ terminalId })),
      "terminal.attach": ({ terminalId }) => terminals.attach(terminalId),
      "terminal.input": ({ terminalId, data }) => terminals.input(terminalId, data),
      "terminal.resize": ({ terminalId, cols, rows }) => terminals.resize(terminalId, cols, rows),
      "terminal.close": ({ terminalId }) => terminals.close(terminalId),
    })
  }),
)
