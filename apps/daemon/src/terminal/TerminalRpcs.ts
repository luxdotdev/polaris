/**
 * Handlers for `terminal.open/attach/attachBinary/input/resize/close`.
 */
import {
  type BlobId,
  NotFound,
  TerminalAttach,
  TerminalAttachBinary,
  TerminalClose,
  type TerminalId,
  TerminalInput,
  TerminalOpen,
  TerminalResize,
} from "@polaris/protocol";
import { Deferred, Effect, Exit, Stream } from "effect";
import { RpcGroup } from "effect/rpc";
import { BlobChannel, ServiceError } from "../services.ts";
import { Terminals } from "./Terminals.ts";

export class TerminalRpcs extends RpcGroup.make(
  TerminalOpen,
  TerminalAttach,
  TerminalAttachBinary,
  TerminalInput,
  TerminalResize,
  TerminalClose
) {}

type BinaryItem =
  | { readonly _tag: "Output"; readonly blobId: BlobId }
  | { readonly _tag: "Exit"; readonly code: number | null };

/**
 * `terminal.attachBinary`: the terminal's output (scrollback, then live) as
 * one long-lived blob, then `Exit`. The blob is sent from the connection's
 * scope, so ending this stream early (the Client detached) stops it.
 */
export const attachBinary = (
  terminals: Terminals["Service"],
  terminalId: TerminalId
): Stream.Stream<BinaryItem, NotFound, BlobChannel> =>
  Stream.unwrap(
    Effect.gen(function* () {
      if (!(yield* terminals.list).some((t) => t.id === terminalId)) {
        return Stream.fail(new NotFound({ what: "terminal", id: terminalId }));
      }
      const blobs = yield* BlobChannel;
      const exit = yield* Deferred.make<number | null>();
      const detached = yield* Deferred.make<void>();
      const output = terminals.attach(terminalId).pipe(
        Stream.takeWhile((item) => {
          if (item._tag === "Output") return true;
          Deferred.doneUnsafe(exit, Exit.succeed(item.code));
          return false;
        }),
        Stream.map((item) => (item as { readonly data: Uint8Array }).data),
        Stream.interruptWhen(Deferred.await(detached)),
        Stream.mapError(
          (error) => new ServiceError({ service: "terminal", message: `${error.what} gone` })
        ),
        // Closed between the check above and the attach: report it as ended.
        Stream.ensuring(Deferred.succeed(exit, null))
      );
      const blobId = yield* blobs.offer(output);
      return Stream.concat(
        Stream.succeed<BinaryItem>({ _tag: "Output", blobId }),
        Stream.fromEffect(
          Effect.map(Deferred.await(exit), (code): BinaryItem => ({ _tag: "Exit", code }))
        )
      ).pipe(
        Stream.onExit((result) =>
          Exit.isSuccess(result) ? Effect.void : Deferred.succeed(detached, undefined)
        )
      );
    })
  );

/** Requires `Terminals` (from `TerminalsLive`), and `BlobChannel` per request. */
export const TerminalRpcsLive = TerminalRpcs.toLayer(
  Effect.gen(function* () {
    const terminals = yield* Terminals;
    return TerminalRpcs.of({
      "terminal.open": (payload) =>
        Effect.map(terminals.open(payload), (terminalId) => ({ terminalId })),
      "terminal.attach": ({ terminalId }) => terminals.attach(terminalId),
      "terminal.attachBinary": ({ terminalId }) => attachBinary(terminals, terminalId),
      "terminal.input": ({ terminalId, data }) => terminals.input(terminalId, data),
      "terminal.resize": ({ terminalId, cols, rows }) => terminals.resize(terminalId, cols, rows),
      "terminal.close": ({ terminalId }) => terminals.close(terminalId),
    });
  })
);
