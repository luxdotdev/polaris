import { and, desc, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import type { Person } from "../api/definition.ts";
import { CommitEmailNotAllowed, PersonNotFound } from "../api/definition.ts";
import { account, user } from "../db/schema.ts";
import { commitEmailChoices, fetchEmails, noreplyEmail } from "../github/index.ts";
import { Accounts, store } from "../server/services.ts";

export type PersonRow = typeof user.$inferSelect;

export const toPerson = (row: PersonRow): Person => ({
  personId: row.id,
  login: row.login,
  name: row.name,
  avatarUrl: row.image ?? null,
});

/** The address that credits this person's work: their choice, else the one set at sign-in. */
export const commitEmailOf = (row: PersonRow) => row.commitEmail ?? row.email;

export const findPerson = Effect.fn("findPerson")(function* (personId: string) {
  const { db } = yield* Accounts;
  const rows = yield* store(() => db.select().from(user).where(eq(user.id, personId)).limit(1));
  const row = rows[0];

  if (row === undefined)
    return yield* Effect.die(new Error(`signed-in person ${personId} is gone`));

  return row;
});

export const findByLogin = Effect.fn("findByLogin")(function* (login: string) {
  const { db } = yield* Accounts;

  const rows = yield* store(() =>
    db
      .select()
      .from(user)
      .where(eq(sql`lower(${user.login})`, login.toLowerCase()))
      .limit(1)
  );

  const row = rows[0];

  if (row === undefined) return yield* new PersonNotFound({ login });

  return row;
});

/** The addresses a person may commit as, asked of GitHub with their stored token. */
const commitEmailsOf = Effect.fn("commitEmailsOf")(function* (row: PersonRow) {
  const { db, config } = yield* Accounts;
  const fallback = [...new Set([commitEmailOf(row), noreplyEmail(config.github, row)])];

  return yield* store(async () => {
    const [linked] = await db
      .select({ accessToken: account.accessToken })
      .from(account)
      .where(and(eq(account.userId, row.id), eq(account.providerId, "github")))
      .orderBy(desc(account.updatedAt))
      .limit(1);

    if (linked?.accessToken == null) throw new Error("no GitHub token on file");

    return commitEmailChoices(
      config.github,
      row,
      await fetchEmails(config.github, linked.accessToken)
    );
  }).pipe(
    Effect.tapError((error) => Effect.logWarning("could not list GitHub addresses", error)),
    Effect.orElseSucceed(() => fallback)
  );
});

export const me = Effect.fn("me")(function* (personId: string) {
  const row = yield* findPerson(personId);

  return {
    ...toPerson(row),
    commitEmail: commitEmailOf(row),
    commitEmails: yield* commitEmailsOf(row),
  };
});

export const setCommitEmail = Effect.fn("setCommitEmail")(function* (
  personId: string,
  commitEmail: string
) {
  const { db } = yield* Accounts;
  const row = yield* findPerson(personId);
  const allowed = yield* commitEmailsOf(row);

  if (!allowed.includes(commitEmail))
    return yield* new CommitEmailNotAllowed({ commitEmail, allowed });
  yield* store(() => db.update(user).set({ commitEmail }).where(eq(user.id, personId)));

  return { ...toPerson(row), commitEmail, commitEmails: allowed };
});
