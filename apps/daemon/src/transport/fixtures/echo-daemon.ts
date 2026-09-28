/**
 * A Daemon stand-in for bridge.test.ts: listens on `<POLARIS_HOME>/daemon.sock`
 * and echoes the first chunk of each connection back, then closes it.
 *
 *   POLARIS_HOME=<dir> bun echo-daemon.ts
 */
import { createServer } from "node:net";
import { paths } from "../../paths.ts";

createServer((socket) => {
  socket.once("data", (data) => socket.end(data));
}).listen(paths().socket);
