import { and, desc, eq } from "drizzle-orm";
import { Effect } from "effect";
import type { Person } from "../api/definition.ts";
import { CommitEmailNotAllowed, PersonNotFound } from "../api/definition.ts";
import { account, user } from "../db/schema.ts";
import type { Database } from "../db/index.ts";
import {
  commitEmailChoices,
  fetchEmails,
  fetchUserByLogin,
  noreplyEmail,
} from "../github/index.ts";
import { Accounts, store } from "../server/services.ts";

export type PersonRow = typeof user.$inferSelect;

export const toPerson = (row: PersonRow): Person => ({
  personId: row.id,
  login: row.login,
  name: row.name,
  avatarUrl: row.image ?? null,
});

/** The address that credits this person's work: their choice, else GitHub's primary verified one. */
export const commitEmailOf = (row: PersonRow) => row.commitEmail ?? row.primaryEmail;

export const findPerson = Effect.fn("findPerson")(function* (personId: string) {
  const { db } = yield* Accounts;
  const rows = yield* store(() => db.select().from(user).where(eq(user.id, personId)).limit(1));
  const row = rows[0];

  if (row === undefined)
    return yield* Effect.die(new Error(`signed-in person ${personId} is gone`));

  return row;
});

/** The GitHub token stored at this person's last sign-in. */
const githubTokenOf = (db: Database, personId: string) => async () => {
  const [linked] = await db
    .select({ accessToken: account.accessToken })
    .from(account)
    .where(and(eq(account.userId, personId), eq(account.providerId, "github")))
    .orderBy(desc(account.updatedAt))
    .limit(1);

  if (linked?.accessToken == null) throw new Error("no GitHub token on file");

  return linked.accessToken;
};

/**
 * The person who holds `login` on GitHub now, asked of GitHub with the asker's token, so a login
 * someone renamed away from never resolves to them.
 */
export const findByLogin = Effect.fn("findByLogin")(function* (askerId: string, login: string) {
  const { db, config } = yield* Accounts;
  const token = yield* store(githubTokenOf(db, askerId));
  const holder = yield* store(() => fetchUserByLogin(config.github, token, login));

  if (holder === undefined) return yield* new PersonNotFound({ login });

  const rows = yield* store(() =>
    db
      .select()
      .from(user)
      .where(eq(user.githubId, String(holder.id)))
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

  return yield* store(async () =>
    commitEmailChoices(
      config.github,
      row,
      await fetchEmails(config.github, await githubTokenOf(db, row.id)())
    )
  ).pipe(
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
