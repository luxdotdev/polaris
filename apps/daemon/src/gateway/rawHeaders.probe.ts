/** Manual bounded probe: bun apps/daemon/src/gateway/rawHeaders.probe.ts. No user Daemon. */
import { Effect } from "effect";
import { connect, type Socket } from "node:net";
import { startGateway } from "./server.ts";

await Effect.runPromise(
  Effect.scoped(
    Effect.gen(function* () {
      const gateway = yield* startGateway({ port: 0, recordPath: null });

      if (gateway === null) throw new Error("gateway did not bind");
      const sockets: Array<Socket> = [];
      const closeAfterMs: Array<number> = [];
      const started = performance.now();
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => sockets.forEach((socket) => socket.destroy()))
      );
      yield* Effect.promise(() =>
        Promise.all(
          Array.from(
            { length: 32 },
            () =>
              new Promise<void>((resolve, reject) => {
                const socket = connect({ host: "127.0.0.1", port: gateway.port });
                sockets.push(socket);
                socket.once("close", () =>
                  closeAfterMs.push(Math.round(performance.now() - started))
                );
                socket.once("error", reject);
                socket.once("connect", () => {
                  socket.write("GET /polaris/rpc HTTP/1.1\r\nHost: localhost\r\nX-Trickle: ");
                  resolve();
                });
              })
          )
        )
      );
      const openInitially = sockets.filter((socket) => !socket.destroyed).length;

      for (let n = 0; n < 12; n++) {
        yield* Effect.sleep(1000);

        for (const socket of sockets) if (!socket.destroyed) socket.write("a");
      }

      const openAfterTrickle = sockets.filter((socket) => !socket.destroyed).length;

      const responses = yield* Effect.promise(() =>
        Promise.all(
          sockets.map(
            (socket) =>
              new Promise<string>((resolve) => {
                if (socket.destroyed) return resolve("closed");

                const timer = setTimeout(() => {
                  socket.destroy();
                  resolve("timeout");
                }, 2000);

                socket.once("data", (data) => {
                  clearTimeout(timer);
                  resolve(data.toString().split("\r\n")[0]!);
                });
                socket.once("close", () => {
                  clearTimeout(timer);
                  resolve("closed");
                });
                socket.write("\r\nConnection: close\r\n\r\n");
              })
          )
        )
      );

      console.log(
        JSON.stringify({
          bun: Bun.version,
          connections: sockets.length,
          elapsedMs: Math.round(performance.now() - started),
          openInitially,
          openAfterTrickle,
          closeAfterMs,
          responses,
        })
      );
    })
  )
);
