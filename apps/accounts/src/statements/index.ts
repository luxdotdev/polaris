import { Effect } from "effect";
import { commitEmailOf, type PersonRow } from "../people/index.ts";
import { Accounts, store } from "../server/services.ts";

/**
 * Signs a statement: an EdDSA JWT binding the person to a device's relay key (`cnf.noiseKey`),
 * valid 15 minutes, verifiable against `{iss}/api/auth/jwks`.
 */
export const signStatement = Effect.fn("signStatement")(function* (
  person: PersonRow,
  noiseKey: string
) {
  const { auth } = yield* Accounts;

  const { token } = yield* store(() =>
    auth.api.signJWT({
      body: {
        payload: {
          iat: Math.floor(Date.now() / 1000),
          sub: person.id,
          cnf: { noiseKey },
          login: person.login,
          name: person.name,
          avatarUrl: person.image ?? null,
          commitEmail: commitEmailOf(person),
        },
      },
    })
  );

  return token;
});
