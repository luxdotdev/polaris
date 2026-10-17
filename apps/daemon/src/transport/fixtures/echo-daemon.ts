/**
 * A Daemon stand-in for bridge.test.ts: listens on `<POLARIS_HOME>/daemon.sock`
 * and echoes the first chunk of each connection back, then closes it.
 *
 *   POLARIS_HOME=<dir> bun echo-daemon.ts
 */
import { createServer } from "node:net";
import { paths } from "../../paths.ts";
import { listenPipe } from "../windowsPipe/index.ts";

// On Windows, the Daemon's own user-owned pipe: an elevated libuv pipe is owned by Administrators.
if (process.platform === "win32") {
  listenPipe(paths().socket, {
    data: (socket, data) => {
      socket.write(data);
      socket.end();
    },
  });
  // The pipe's pending connect alone doesn't keep Bun's event loop alive.
  setInterval(() => {}, 60_000);
} else
  createServer((socket) => {
    socket.once("data", (data) => socket.end(data));
  }).listen(paths().socket);
