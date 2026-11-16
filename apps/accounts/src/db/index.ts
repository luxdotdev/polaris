import { SQL } from "bun";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import { join } from "node:path";
import * as schema from "./schema.ts";

export const openDatabase = (url: string) => {
  const client = new SQL(url);

  return { db: drizzle({ client, schema }), close: () => client.close() };
};

export type Database = ReturnType<typeof openDatabase>["db"];

/** Applies `drizzle/`'s migrations (or `MIGRATIONS_DIR`'s, in the image); safe on every start. */
export const migrateDatabase = (db: Database) =>
  migrate(db, {
    migrationsFolder: process.env["MIGRATIONS_DIR"] ?? join(import.meta.dir, "../../drizzle"),
  });
