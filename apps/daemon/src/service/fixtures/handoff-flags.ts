import { strict as assert } from "node:assert";
import { Effect } from "effect";
import { closeFd, setCloseOnExec, socketPair } from "../libc.ts";
import { adoptListener, listenerFd, prepareHandoff, takeHandoff } from "../upgrade.ts";
import { paths } from "../../paths.ts";

const listener = Bun.listen({ unix: paths().socket, socket: { data() {} } });

const pair = socketPair();

const fd = listenerFd(listener);

try {
  const env = await Effect.runPromise(prepareHandoff(fd, { fds: { "harness:proof": pair[0] } }));

  Object.assign(process.env, env);
  setCloseOnExec(fd);
  setCloseOnExec(pair[0]);
  const adopted = await Effect.runPromise(adoptListener());

  assert.equal(adopted?.fd, fd);
  assert.equal((await Effect.runPromise(takeHandoff()))?.fds["harness:proof"], pair[0]);
  console.log("PASS: inherited Linux listener and child socket survive startup FD_CLOEXEC reset");
} finally {
  listener.stop(true);
  closeFd(pair[0]);
  closeFd(pair[1]);
}
