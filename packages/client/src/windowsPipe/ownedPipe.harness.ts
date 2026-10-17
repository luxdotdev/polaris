/**
 * Run under Node on Windows by `ownedPipe.test.ts` (Bun can't adopt a handle as a socket):
 * connects to pipes of known owners through `connectOwnedPipe` and prints one JSON line each.
 */
import { randomUUID } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { Effect } from "effect";
import { connectOwnedPipe } from "./index.ts";
import { servePipe } from "./win32.testing.ts";
import { loadPipeApi } from "./win32.ts";

const fresh = () => `\\\\.\\pipe\\polaris-owner-test-${randomUUID()}`;

const pipes = loadPipeApi();

const user = pipes.userSid();

type Fields = Record<string, string | null | undefined>;

const report = (scenario: string, fields: Fields) =>
  console.log(JSON.stringify({ scenario, ...fields }));

const roundTrip = (client: Socket, server: Socket) =>
  new Promise<string>((resolve, reject) => {
    server.on("data", (data) => server.write(`echo:${data.toString()}`));
    client.once("data", (data) => resolve(data.toString()));
    client.once("error", reject);
    client.write("hi");
  });

/** What `connectOwnedPipe` made of `name`: the echo through it, or the failure's reason. */
const attempt = async (name: string, accept: () => Socket | null) => {
  const outcome = await Effect.runPromise(
    Effect.match(connectOwnedPipe(name), {
      onFailure: (failure) => ({ refused: failure.reason, detail: failure.detail }),
      onSuccess: (socket) => ({ socket }),
    })
  );

  if ("refused" in outcome) return { refused: outcome.refused, detail: outcome.detail };

  const client = outcome.socket;
  const server = accept();

  if (server === null) return { echoed: "no server end" };

  const echoed = await roundTrip(client, server);

  client.destroy();
  server.destroy();

  return { echoed };
};

const ours = fresh();

const instance = servePipe(ours, `O:${user}D:P(A;;GA;;;${user})`);

report("this user's pipe", await attempt(ours, instance.accept));

// Only an elevated token may make Administrators the owner (Win32 error 1307 otherwise).
const administrators = fresh();

try {
  servePipe(administrators, `O:BAD:P(A;;GA;;;${user})`);
  report("a pipe Administrators own", await attempt(administrators, () => null));
} catch (error) {
  report("a pipe Administrators own", { skipped: String(error) });
}

const nodePipe = fresh();

const nodeServer = createServer((socket) => socket.on("data", () => socket.end()));

await new Promise<void>((resolve) => nodeServer.listen(nodePipe, resolve));

const opened = pipes.open(nodePipe);

const nodeOwner = "handle" in opened ? pipes.ownerSid(opened.handle) : null;

if ("handle" in opened) pipes.close(opened.handle);

report("a Node pipe", { owner: nodeOwner, user, ...(await attempt(nodePipe, () => null)) });

nodeServer.close();

report("no pipe", await attempt(fresh(), () => null));
