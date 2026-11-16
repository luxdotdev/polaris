import { Effect, Redacted, Schedule } from "effect";
import { readConfig } from "./config.ts";
import { migrateDatabase, openDatabase } from "./db/index.ts";
import { accountServer } from "./server/index.ts";
import { MAX_WAIT_S } from "./api/longPoll.ts";

const config = await Effect.runPromise(readConfig);

const { db } = openDatabase(Redacted.value(config.databaseUrl));

// Postgres may still be starting beside it (compose, the README's docker commands): retry for a minute.
await Effect.runPromise(
  Effect.tryPromise(() => migrateDatabase(db)).pipe(
    Effect.tapError(() => Effect.logWarning("Postgres isn't ready; retrying")),
    Effect.retry({ schedule: Schedule.spaced("2 seconds"), times: 30 })
  )
);

const server = accountServer(config, db);

// Long-polls hold a request up to MAX_WAIT_S; Bun's default idle timeout is 10 s.
const http = Bun.serve({ port: config.port, idleTimeout: MAX_WAIT_S + 15, fetch: server.fetch });

console.log(`Account Server for ${config.origin} on :${http.port}`);
