#!/usr/bin/env bun
/**
 * Shared sessions for the simulator (ENG-941, ENG-944): a local Account Server with a fake GitHub
 * (Postgres in Docker), a real relay, this iPhone's dev Daemon behind the dev bridge, and an
 * owner's Daemon (@octocat) that shares two sessions with @hubot, the person the app signs in as.
 * No real GitHub, relay or Polaris Cloud. Commands on stdin: `turn <text>`, `offline`, `online`.
 *
 *   POLARIS_RELAY_BIN=<polaris-relay> bun run --cwd apps/mobile dev:sharing
 */
import { connectRpc, socketTransport } from "@polaris/client";
import { Command, CommandId, InviteId, PersonId, SessionId, ShareTarget } from "@polaris/protocol";
import { createPolaris } from "@polaris/sdk";
import { launchDaemon, TEST_USER_KEY, type TestDaemon } from "@polaris/sdk/testing";
import { Effect, Redacted, Schema, Scope } from "effect";
import { readJson, startAccounts } from "../../accounts/src/testing/harness.ts";
import { relayBinary } from "../../relay/contract/testing/binary.ts";
import { formatDevBridge } from "../src/runtime/devBridge.ts";
import { startDevBridge } from "./devBridge.ts";

const people = {
  octocat: {
    id: 583_231,
    login: "octocat",
    name: "The Octocat",
    emails: [{ email: "octocat@lux.dev", primary: true, verified: true }],
  },
  hubot: {
    id: 1001,
    login: "hubot",
    name: "Hubot",
    emails: [
      { email: "hubot@acme.example", primary: true, verified: true },
      { email: "hubot@personal.example", primary: false, verified: true },
    ],
  },
} as const;

const accounts = await startAccounts();

const owner = await accounts.signIn(people.octocat);

// The app's sign-in sheet consents as whoever signed in last.
await accounts.signIn(people.hubot);

const relayPort = 20_000 + Math.floor(Math.random() * 20_000);

const relayUrl = `ws://127.0.0.1:${relayPort}/v1`;

const relay = Bun.spawn([relayBinary()], {
  env: { ...process.env, PORT: String(relayPort), POLARIS_RELAY_HOSTNAME: "127.0.0.1" },
  stdout: "ignore",
  stderr: "inherit",
});

const relayUp = () =>
  fetch(`http://127.0.0.1:${relayPort}/healthz`).then(
    () => true,
    () => false
  );

for (let tries = 0; !(await relayUp()); tries++) {
  if (tries > 200) throw new Error("the relay did not start");
  await Bun.sleep(50);
}

// Secrets under each Daemon's home, never the Keychain: two Daemons there share one relay key.
const main = new URL("../../daemon/src/main.testing.ts", import.meta.url).pathname;

const admin = async (daemon: TestDaemon) => {
  const scope = Effect.runSync(Scope.make());

  const { client } = await Effect.runPromise(
    Scope.provide(
      Effect.gen(function* () {
        const connection = yield* connectRpc(yield* socketTransport(daemon.socketPath));

        yield* connection.client.hello({
          clientName: "mobile-dev-sharing",
          clientVersion: "0.0.0",
          deviceLabel: "Mobile dev sharing",
          capabilities: [],
          userKey: Redacted.make(TEST_USER_KEY),
        });

        return connection;
      }),
      scope
    )
  );

  return client;
};

const startSessions = async (daemon: TestDaemon, prompts: ReadonlyArray<string>) => {
  const workspaceId = await daemon.registerWorkspace();

  const starter = await createPolaris({
    pairings: [await daemon.pair("Mobile dev setup", ["read", "approve", "start"], "gateway")],
    clientName: "Mobile dev setup",
  });

  const ids: Array<string> = [];

  for (const prompt of prompts)
    ids.push(await starter.startSession(daemon.hostId, { workspaceId, harness: "claude", prompt }));

  return { starter, ids };
};

// This iPhone's Host: its own sessions, which it shares from the Share sheet.
const phone = await launchDaemon({ main });

const phoneAdmin = await admin(phone);

// On, so the phone can link through it and share from its own Host.
await Effect.runPromise(phoneAdmin["relayRoute.enable"]({ url: relayUrl }));

await (await startSessions(phone, ["Summarise the README", "List the files"])).starter.close();

// The owner's Host, sharing two sessions with @hubot: one to open, one left as an Invite.
const ownerDaemon = await launchDaemon({ main });

const ownerAdmin = await admin(ownerDaemon);

const route = await Effect.runPromise(ownerAdmin["relayRoute.enable"]({ url: relayUrl }));

const ownerSessions = await startSessions(ownerDaemon, [
  "Fix the login redirect",
  "Bump the Effect version",
]);

const Person = Schema.Struct({ personId: Schema.String });

const Created = Schema.Struct({ inviteId: Schema.String, hostCapability: Schema.String });

const hubot = await readJson(
  await accounts.call("GET", "/v1/people?login=hubot", { token: owner.token }),
  Person
);

const titles = ["Fix the login redirect", "Bump the Effect version"];

for (const [at, sessionId] of ownerSessions.ids.entries()) {
  const invite = await readJson(
    await accounts.call("POST", "/v1/invites", {
      token: owner.token,
      body: {
        inviteeLogin: "hubot",
        share: { id: sessionId, title: titles[at], kind: "session" },
        host: {
          name: "Octocat's Mac Studio",
          relayAddress: route.hostAddress,
          noiseKey: route.hostNoiseKey,
          relayUrl,
        },
        role: "contributor",
        expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
    }),
    Created
  );

  await Effect.runPromise(
    ownerAdmin["shares.create"]({
      target: ShareTarget.cases.Session.make({ sessionId: SessionId.make(sessionId) }),
      personId: PersonId.make(hubot.personId),
      inviteeLogin: "hubot",
      role: "contributor",
      expiresAt: null,
      issuer: accounts.origin,
      inviteId: InviteId.make(invite.inviteId),
      hostCapability: Redacted.make(invite.hostCapability),
    })
  );
}

const bridge = startDevBridge(phone.socketPath);

console.log(`Account Server: ${accounts.origin} (sign in as @hubot)`);

console.log(`Relay: ${relayUrl}`);

console.log(`Owner's Daemon home: ${ownerDaemon.home}`);

console.log(
  `Start Metro with:\nEXPO_PUBLIC_POLARIS_DEV_BRIDGE=${formatDevBridge({ hostId: phone.hostId, port: bridge.port, token: bridge.token })}`
);

console.log("stdin: turn <text> | offline | online. Ctrl-C stops everything.");

const [sharedSession] = ownerSessions.ids;

const command = async (line: string) => {
  // As the owner's own Client, so the Turn is the owner's.
  if (line.startsWith("turn ") && sharedSession !== undefined)
    await Effect.runPromise(
      ownerAdmin.dispatch({
        commandId: CommandId.make(crypto.randomUUID()),
        command: Command.cases.SendTurn.make({
          sessionId: SessionId.make(sharedSession),
          prompt: line.slice(5),
          attachments: [],
        }),
      })
    );

  if (line === "offline") await Effect.runPromise(ownerAdmin["relayRoute.disable"]());

  if (line === "online")
    await Effect.runPromise(ownerAdmin["relayRoute.enable"]({ url: relayUrl }));
  console.log(`done: ${line}`);
};

const stop = async () => {
  bridge.stop();
  await ownerSessions.starter.close();
  await Promise.all([phone.stop(), ownerDaemon.stop()]);
  relay.kill();
  await accounts.stop();
  process.exit(0);
};

process.on("SIGINT", () => void stop());

for await (const line of console) await command(line.trim()).catch((e) => console.error(e));
